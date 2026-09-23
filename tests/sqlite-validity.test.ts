import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { generateSQLite } from "../src/generator/sqlite.ts";
import { diffSchemas } from "../src/migrate/diff.ts";
import { generateSeedSql } from "../src/seed/seed.ts";
import { assertValidSchema } from "../src/schema/validator.ts";

// Loaded via require(): Vite's resolver can't handle the `node:sqlite`
// specifier (strips it to bare `sqlite`), while Node runs it fine.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

function loadExampleSql(): string {
  const raw = readFileSync(new URL("../schema.json", import.meta.url), "utf8");
  const parsed: unknown = JSON.parse(raw);
  assertValidSchema(parsed);
  return generateSQLite(parsed);
}

describe("generated DDL runs on real SQLite", () => {
  it("creates the example tables", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(loadExampleSql());
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toEqual(["posts", "users"]);
    db.close();
  });

  it("enforces the FK with cascade delete", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec(loadExampleSql());

    db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run("u1", "Ada");
    db.prepare("INSERT INTO posts (id, user_id) VALUES (?, ?)").run("p1", "u1");
    expect(() =>
      db.prepare("INSERT INTO posts (id, user_id) VALUES (?, ?)").run("p2", "ghost"),
    ).toThrow();

    db.prepare("DELETE FROM users WHERE id = ?").run("u1");
    const posts = db.prepare("SELECT id FROM posts").all();
    expect(posts).toEqual([]);
    db.close();
  });

  it("enforces UNIQUE and applies DEFAULTs", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      generateSQLite({
        users: {
          columns: [
            { c_name: "id", c_type: "integer", is_primary_key: true },
            { c_name: "email", c_type: "text", is_nullable: false, is_unique: true },
            { c_name: "nick", c_type: "text", default: "anon" },
          ],
        },
      }),
    );

    db.prepare("INSERT INTO users (email) VALUES (?)").run("a@x.io");
    expect(() =>
      db.prepare("INSERT INTO users (email) VALUES (?)").run("a@x.io"),
    ).toThrow();
    const row = db.prepare("SELECT nick FROM users WHERE email = ?").get("a@x.io") as {
      nick: string;
    };
    expect(row.nick).toBe("anon");
    db.close();
  });

  it("applies a migration diff to a real database", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      generateSQLite({
        users: {
          columns: [
            { c_name: "id", c_type: "integer", is_primary_key: true },
            { c_name: "name", c_type: "text", is_nullable: false },
          ],
        },
      }),
    );

    const { statements, warnings } = diffSchemas(
      {
        users: {
          columns: [
            { c_name: "id", c_type: "integer", is_primary_key: true },
            { c_name: "name", c_type: "text", is_nullable: false },
          ],
        },
      },
      {
        users: {
          columns: [
            { c_name: "id", c_type: "integer", is_primary_key: true },
            { c_name: "name", c_type: "text", is_nullable: false },
            { c_name: "email", c_type: "text", is_unique: true },
          ],
          indexes: [{ columns: ["email"] }],
        },
      },
    );
    expect(warnings).toEqual([]);
    db.exec(statements.join("\n"));

    db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run("Ada", "a@x.io");
    const row = db.prepare("SELECT email FROM users WHERE name = ?").get("Ada") as {
      email: string;
    };
    expect(row.email).toBe("a@x.io");
    // Uniqueness survived the migration via its own index.
    expect(() =>
      db.prepare("INSERT INTO users (name, email) VALUES (?, ?)").run("Bo", "a@x.io"),
    ).toThrow();
    db.close();
  });

  it("enforces composite UNIQUE indexes", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(
      generateSQLite({
        posts: {
          columns: [
            { c_name: "id", c_type: "integer", is_primary_key: true },
            { c_name: "user_id", c_type: "text", is_nullable: false },
            { c_name: "slug", c_type: "text", is_nullable: false },
          ],
          indexes: [{ columns: ["user_id", "slug"], unique: true }],
        },
      }),
    );

    db.prepare("INSERT INTO posts (user_id, slug) VALUES (?, ?)").run("u1", "hello");
    db.prepare("INSERT INTO posts (user_id, slug) VALUES (?, ?)").run("u2", "hello");
    expect(() =>
      db.prepare("INSERT INTO posts (user_id, slug) VALUES (?, ?)").run("u1", "hello"),
    ).toThrow();
    db.close();
  });

  it("rebuilds a table on real SQLite, preserving data and FKs", () => {
    const db = new DatabaseSync(":memory:");
    const before = {
      users: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "name", c_type: "text", is_nullable: false },
        ],
      },
      posts: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "user_id", c_type: "text", is_nullable: false },
        ],
        relations: [
          {
            type: "many_to_one" as const,
            column: "user_id",
            references: { table: "users", column: "id" },
            on_delete: "cascade" as const,
          },
        ],
      },
    };
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(generateSQLite(before));
    db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run("u1", "Ada");
    db.prepare("INSERT INTO posts (id, user_id) VALUES (?, ?)").run("p1", "u1");

    // Loosen posts.user_id to nullable: needs a rebuild of posts.
    const after = {
      ...before,
      posts: {
        ...before.posts,
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "user_id", c_type: "text", is_nullable: true },
        ],
      },
    };
    const { statements, warnings } = diffSchemas(before, after);
    expect(warnings).toEqual([]);
    db.exec(statements.join("\n"));

    // Data survived, FK still enforced, cascade still works.
    const rows = db.prepare("SELECT id, user_id FROM posts").all();
    expect(rows).toEqual([{ id: "p1", user_id: "u1" }]);
    expect(() =>
      db.prepare("INSERT INTO posts (id, user_id) VALUES (?, ?)").run("p2", "ghost"),
    ).toThrow();
    db.prepare("DELETE FROM users WHERE id = ?").run("u1");
    expect(db.prepare("SELECT id FROM posts").all()).toEqual([]);
    db.close();
  });

  it("seeds a fresh database end to end: DDL + INSERTs with FKs on", () => {
    const db = new DatabaseSync(":memory:");
    const schema = {
      users: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "name", c_type: "text", is_nullable: false },
        ],
      },
      posts: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "user_id", c_type: "text", is_nullable: false },
        ],
        relations: [
          {
            type: "many_to_one" as const,
            column: "user_id",
            references: { table: "users", column: "id" },
            on_delete: "cascade" as const,
          },
        ],
      },
    };
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(generateSQLite(schema));
    db.exec(
      generateSeedSql(schema, {
        posts: [{ id: "p1", user_id: "u1" }],
        users: [{ id: "u1", name: "Ada" }],
      }),
    );

    const rows = db
      .prepare("SELECT p.id, u.name FROM posts p JOIN users u ON u.id = p.user_id")
      .all();
    expect(rows).toEqual([{ id: "p1", name: "Ada" }]);
    db.close();
  });
});
