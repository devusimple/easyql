import { describe, expect, it } from "vitest";
import { generateSeedSql, validateSeed } from "../src/seed/seed.ts";
import type { DatabaseSchema } from "../src/schema/types.ts";

const schema: DatabaseSchema = {
  users: {
    columns: [
      { c_name: "id", c_type: "text", is_primary_key: true },
      { c_name: "name", c_type: "text", is_nullable: false },
      { c_name: "nick", c_type: "text", default: "anon" },
      { c_name: "score", c_type: "integer" },
    ],
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

const good = {
  posts: [{ id: "p1", user_id: "u1" }],
  users: [{ id: "u1", name: "Ada", score: 3 }],
};

describe("validateSeed", () => {
  it("accepts a valid self-contained seed", () => {
    expect(validateSeed(schema, good)).toEqual([]);
  });

  it("rejects unknown tables/columns, missing required, and bad shapes", () => {
    const issues = validateSeed(schema, {
      nope: [],
      users: ["not-an-object", { id: "u1", bogus: 1 }, { name: "no-id" }],
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("nope");
    expect(paths).toContain("users[0]");
    expect(paths).toContain("users[1].bogus");
    expect(paths).toContain("users[2]");
  });

  it("rejects wrong types, nulls into NOT NULL, and blob seeds", () => {
    const withBlob: DatabaseSchema = {
      f: { columns: [{ c_name: "raw", c_type: "blob" }] },
    };
    const paths = validateSeed(schema, {
      users: [
        { id: "u1", name: "Ada", score: 1.5 },
        { id: "u2", name: null },
        { id: "u3", name: "Bo", score: true },
      ],
    }).map((i) => i.path);
    expect(paths).toContain("users[0].score");
    expect(paths).toContain("users[1].name");
    expect(paths).toContain("users[2].score");
    expect(validateSeed(withBlob, { f: [{ raw: "zz" }] })).toHaveLength(1);
  });

  it("rejects dangling foreign keys but allows nulls on nullable columns", () => {
    const dangling = validateSeed(schema, {
      users: [{ id: "u1", name: "Ada" }],
      posts: [{ id: "p1", user_id: "ghost" }],
    });
    expect(dangling.map((i) => i.path)).toContain("posts[0].user_id");

    const nullable: DatabaseSchema = {
      posts: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "user_id", c_type: "text", is_nullable: true },
        ],
        relations: [
          {
            type: "many_to_one",
            column: "user_id",
            references: { table: "users", column: "id" },
          },
        ],
      },
      users: schema.users,
    };
    expect(
      validateSeed(nullable, {
        users: [{ id: "u1", name: "Ada" }],
        posts: [{ id: "p1", user_id: null }],
      }),
    ).toEqual([]);
  });
});

describe("generateSeedSql", () => {
  it("emits parents first with escaped multi-row VALUES", () => {
    const sql = generateSeedSql(schema, {
      posts: [{ id: "p1", user_id: "u1" }],
      users: [
        { id: "u1", name: "o'brien" },
        { id: "u2", name: "Bo", score: null },
      ],
    });
    expect(sql.indexOf("INSERT INTO \"users\"")).toBeLessThan(sql.indexOf("INSERT INTO \"posts\""));
    expect(sql).toContain(`'o''brien'`);
    expect(sql).toContain("NULL");
  });

  it("is empty for empty input", () => {
    expect(generateSeedSql(schema, {})).toBe("");
    expect(generateSeedSql(schema, { users: [] })).toBe("");
  });
});
