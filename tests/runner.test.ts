import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { hashSchema, migrateDatabase, type DbConnection } from "../src/migrate/runner.ts";
import type { DatabaseSchema } from "../src/schema/types.ts";

// Same require() workaround as sqlite-validity.test.ts: Vite can't resolve
// the `node:sqlite` specifier, Node runs it fine.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

function memoryDb(): DbConnection {
  const db = new DatabaseSync(":memory:");
  return {
    exec: (sql: string) => db.exec(sql),
    query: (sql: string) => db.prepare(sql).all() as Record<string, unknown>[],
    close: () => db.close(),
  };
}

const v1: DatabaseSchema = {
  users: {
    columns: [
      { c_name: "id", c_type: "text", is_primary_key: true },
      { c_name: "name", c_type: "text", is_nullable: false },
    ],
  },
};

const v2: DatabaseSchema = {
  users: {
    columns: [
      { c_name: "id", c_type: "text", is_primary_key: true },
      { c_name: "name", c_type: "text", is_nullable: false },
      { c_name: "email", c_type: "text" },
    ],
  },
};

describe("migrateDatabase", () => {
  it("migrates a fresh database including seeds, then reports up-to-date", () => {
    const db = memoryDb();
    const first = migrateDatabase(db, {
      schema: v1,
      seedData: { users: [{ id: "u1", name: "Ada" }] },
    });
    expect(first.status).toBe("fresh");
    expect(first.applied.length).toBeGreaterThan(0);

    const rows = db.query("SELECT id, name FROM users;");
    expect(rows).toEqual([{ id: "u1", name: "Ada" }]);

    const second = migrateDatabase(db, { schema: v1 });
    expect(second).toEqual({ status: "up-to-date", applied: [], warnings: [] });
    db.close();
  });

  it("applies schema diffs and skips seeds on initialized databases", () => {
    const db = memoryDb();
    migrateDatabase(db, {
      schema: v1,
      seedData: { users: [{ id: "u1", name: "Ada" }] },
    });
    const result = migrateDatabase(db, {
      schema: v2,
      seedData: { users: [{ id: "u2", name: "Bo" }] },
    });
    expect(result.status).toBe("migrated");
    expect(result.applied).toContain('ALTER TABLE "users" ADD COLUMN "email" TEXT;');
    expect(result.warnings).toHaveLength(1);
    expect(db.query("SELECT id, email FROM users;")).toEqual([{ id: "u1", email: null }]);
    db.close();
  });

  it("baselines without applying anything", () => {
    const db = memoryDb();
    const result = migrateDatabase(db, { schema: v1, baseline: true });
    expect(result.status).toBe("baselined");
    expect(result.applied).toEqual([]);
    // Adopted, not created: the table doesn't exist, but state is recorded.
    expect(() => db.query("SELECT * FROM users;")).toThrow();
    const again = migrateDatabase(db, { schema: v1 });
    expect(again.status).toBe("up-to-date");
    db.close();
  });

  it("rolls back when the result would violate foreign keys", () => {
    const db = memoryDb();
    migrateDatabase(db, { schema: v1 });
    // Smuggle in an orphan with enforcement off.
    db.exec("PRAGMA foreign_keys=OFF;");
    db.exec(
      "CREATE TABLE strays (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id)); INSERT INTO strays VALUES ('s1', 'ghost');",
    );
    db.exec("PRAGMA foreign_keys=ON;");

    // Any migration now must fail atomically: journal keeps the old hash and
    // existing data is untouched.
    expect(() => migrateDatabase(db, { schema: v2 })).toThrow(/rolled back/);
    expect(db.query("SELECT id FROM users;")).toEqual([]);
    expect(db.query("SELECT id FROM strays;")).toEqual([{ id: "s1" }]);
    const retry = migrateDatabase(db, { schema: v1 });
    expect(retry.status).toBe("up-to-date");
    db.close();
  });

  it("hashes schemas deterministically regardless of key order", () => {
    const shuffled: DatabaseSchema = {
      users: {
        columns: [
          { c_name: "name", c_type: "text", is_nullable: false },
          { c_name: "id", c_type: "text", is_primary_key: true },
        ],
      },
    };
    const reordered: DatabaseSchema = {
      users: {
        columns: [
          { c_type: "text", c_name: "id", is_primary_key: true },
          { is_nullable: false, c_type: "text", c_name: "name" },
        ],
      },
    };
    // Same column *set* in different order is a different schema (order is
    // significant in DDL), but key order within one column object is not.
    expect(hashSchema(v1)).toBe(hashSchema(reordered));
    expect(hashSchema(v1)).not.toBe(hashSchema(shuffled));
    expect(hashSchema(v1)).not.toBe(hashSchema(v2));
  });
});
