import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { generateSQLite } from "../src/generator/sqlite.ts";
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
});
