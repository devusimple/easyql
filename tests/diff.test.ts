import { describe, expect, it } from "vitest";
import { diffSchemas } from "../src/migrate/diff.ts";
import type { DatabaseSchema } from "../src/schema/types.ts";

const v1: DatabaseSchema = {
  users: {
    columns: [
      { c_name: "id", c_type: "text", is_primary_key: true },
      { c_name: "name", c_type: "text", is_nullable: false },
    ],
  },
  legacy: {
    columns: [{ c_name: "id", c_type: "integer", is_primary_key: true }],
  },
};

const v2: DatabaseSchema = {
  users: {
    columns: [
      { c_name: "id", c_type: "text", is_primary_key: true },
      { c_name: "name", c_type: "text", is_nullable: false },
      { c_name: "email", c_type: "text", is_unique: true },
    ],
    indexes: [{ columns: ["email"] }],
  },
  posts: {
    columns: [
      { c_name: "id", c_type: "text", is_primary_key: true },
      { c_name: "user_id", c_type: "text", is_nullable: false },
    ],
    relations: [
      {
        type: "many_to_one",
        column: "user_id",
        references: { table: "users", column: "id" },
        on_delete: "cascade",
      },
    ],
  },
};

describe("diffSchemas", () => {
  it("emits drops, creates, added columns, and added indexes", () => {
    const { statements, warnings } = diffSchemas(v1, v2);
    expect(warnings).toEqual([]);
    expect(statements).toContain('DROP TABLE "legacy";');
    // UNIQUE can't ride along on ADD COLUMN: plain column + own unique index…
    expect(statements).toContain('ALTER TABLE "users" ADD COLUMN "email" TEXT;');
    expect(statements).toContain('CREATE UNIQUE INDEX "uq_users_email" ON "users" ("email");');
    // …plus the declared non-unique index from the new schema.
    expect(statements).toContain('CREATE INDEX "idx_users_email" ON "users" ("email");');
    expect(statements.some((s) => s.startsWith('CREATE TABLE "posts"'))).toBe(true);
    expect(statements.findIndex((s) => s.startsWith("DROP TABLE"))).toBe(0);
  });

  it("warns instead of emitting what SQLite ALTER TABLE can't do", () => {
    const changed: DatabaseSchema = {
      users: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          // NOT NULL removed: needs a rebuild
          { c_name: "name", c_type: "text" },
        ],
      },
    };
    const withFk: DatabaseSchema = {
      users: v1.users,
      posts: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "user_id", c_type: "text" },
        ],
        relations: [
          {
            type: "many_to_one",
            column: "user_id",
            references: { table: "users", column: "id" },
            on_delete: "cascade",
          },
        ],
      },
    };
    expect(diffSchemas(v1, changed).warnings).toHaveLength(1);
    // Only legit statement left: `changed` drops the legacy table.
    expect(diffSchemas(v1, changed).statements).toEqual(['DROP TABLE "legacy";']);
    // posts is a new table: created whole, no FK warning for it
    expect(diffSchemas(v1, withFk).warnings).toEqual([]);
  });

  it("recreates a changed index via DROP + CREATE", () => {
    const a: DatabaseSchema = {
      t: {
        columns: [
          { c_name: "x", c_type: "text" },
          { c_name: "y", c_type: "text" },
        ],
        indexes: [{ columns: ["x"], name: "ix" }],
      },
    };
    const b: DatabaseSchema = {
      t: {
        columns: [
          { c_name: "x", c_type: "text" },
          { c_name: "y", c_type: "text" },
        ],
        indexes: [{ columns: ["x", "y"], unique: true, name: "ix" }],
      },
    };
    const { statements } = diffSchemas(a, b);
    expect(statements).toEqual([
      'DROP INDEX "ix";',
      'CREATE UNIQUE INDEX "ix" ON "t" ("x", "y");',
    ]);
  });

  it("is empty for identical schemas", () => {
    expect(diffSchemas(v1, v1)).toEqual({ statements: [], warnings: [] });
  });
});
