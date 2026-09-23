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

  it("inlines an added foreign key on a new column — no rebuild", () => {
    const old: DatabaseSchema = {
      users: v1.users,
      posts: {
        columns: [{ c_name: "id", c_type: "text", is_primary_key: true }],
      },
    };
    const next: DatabaseSchema = {
      users: v1.users,
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
    const { statements, warnings } = diffSchemas(old, next);
    expect(warnings).toEqual([]);
    expect(statements).toEqual([
      'ALTER TABLE "posts" ADD COLUMN "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE;',
    ]);
  });

  it("rebuilds a table whose column changed, preserving shared data", () => {
    const changed: DatabaseSchema = {
      users: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          // NOT NULL removed: SQLite can't ALTER a column
          { c_name: "name", c_type: "text" },
        ],
      },
      legacy: v1.legacy,
    };
    const { statements, warnings } = diffSchemas(v1, changed);
    expect(warnings).toEqual([]);
    expect(statements[0]).toBe("PRAGMA foreign_keys=OFF;");
    expect(statements[statements.length - 1]).toBe("PRAGMA foreign_key_check;");
    expect(statements).toContain('ALTER TABLE "users" RENAME TO "_easyql_backup_users";');
    expect(statements.some((s) => s.startsWith('CREATE TABLE "users"'))).toBe(true);
    expect(statements).toContain(
      'INSERT INTO "users" ("id", "name") SELECT "id", "name" FROM "_easyql_backup_users";',
    );
    expect(statements).toContain('DROP TABLE "_easyql_backup_users";');
  });

  it("rebuilds for added/dropped FKs on existing columns and added PKs", () => {
    const base: DatabaseSchema = {
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
    const noFk: DatabaseSchema = {
      users: v1.users,
      posts: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "user_id", c_type: "text" },
        ],
      },
    };
    // Dropped FK, column survives → rebuild (SQLite can't DROP CONSTRAINT).
    expect(diffSchemas(base, noFk).warnings).toEqual([]);
    expect(diffSchemas(base, noFk).statements.some((s) => s.includes("RENAME TO"))).toBe(true);
    // And back: added FK on an existing column → rebuild too.
    expect(diffSchemas(noFk, base).statements.some((s) => s.includes("RENAME TO"))).toBe(true);

    const addedPk: DatabaseSchema = {
      solo: {
        columns: [
          { c_name: "id", c_type: "integer", is_primary_key: true },
          { c_name: "code", c_type: "text", is_primary_key: true },
        ],
      },
    };
    const before: DatabaseSchema = {
      solo: {
        columns: [
          { c_name: "id", c_type: "integer", is_primary_key: true },
          { c_name: "code", c_type: "text" },
        ],
      },
    };
    const pkDiff = diffSchemas(before, addedPk);
    expect(pkDiff.warnings).toEqual([]);
    expect(pkDiff.statements.some((s) => s.includes("_easyql_backup_solo"))).toBe(true);
  });

  it("rebuilds children when a parent is rebuilt", () => {
    const parent: DatabaseSchema = {
      users: v1.users,
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
    // Changing users.id forces a users rebuild; posts must rebuild too or
    // its REFERENCES would dangle at the backup name.
    const changedPk: DatabaseSchema = {
      users: {
        columns: [
          { c_name: "id", c_type: "integer", is_primary_key: true },
          { c_name: "name", c_type: "text", is_nullable: false },
        ],
      },
      posts: parent.posts,
    };
    const { statements, warnings } = diffSchemas(parent, changedPk);
    expect(warnings).toEqual([]);
    expect(statements).toContain('ALTER TABLE "users" RENAME TO "_easyql_backup_users";');
    expect(statements).toContain('ALTER TABLE "posts" RENAME TO "_easyql_backup_posts";');
    // Parent block precedes the child block.
    expect(
      statements.findIndex((s) => s.includes("_easyql_backup_users")),
    ).toBeLessThan(statements.findIndex((s) => s.includes("_easyql_backup_posts")));
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
