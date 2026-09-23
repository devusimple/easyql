import { describe, expect, it } from "vitest";
import { validateSchema } from "../src/schema/validator.ts";

describe("validateSchema", () => {
  it("accepts the example users/posts schema", () => {
    const issues = validateSchema({
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
            type: "many_to_one",
            column: "user_id",
            references: { table: "users", column: "id" },
            on_delete: "cascade",
          },
        ],
      },
    });
    expect(issues).toEqual([]);
  });

  it("rejects unknown referenced table/column and bad types", () => {
    const issues = validateSchema({
      posts: {
        columns: [{ c_name: "user_id", c_type: "oops" }],
        relations: [
          {
            type: "many_to_one",
            column: "missing_col",
            references: { table: "users", column: "id" },
            on_delete: "explode",
          },
        ],
      },
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("posts.columns[0].c_type");
    expect(paths).toContain("posts.relations[0].column");
    expect(paths).toContain("posts.relations[0].references.table");
    expect(paths).toContain("posts.relations[0].on_delete");
  });

  it("rejects bad indexes: unknown columns, empty lists, duplicate names", () => {
    const issues = validateSchema({
      a: {
        columns: [{ c_name: "x", c_type: "text" }],
        indexes: [
          { columns: [] },
          { columns: ["nope"] },
          { columns: ["x"], name: "shared" },
        ],
      },
      b: {
        columns: [{ c_name: "y", c_type: "text" }],
        indexes: [{ columns: ["y"], name: "shared" }],
      },
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("a.indexes[0].columns");
    expect(paths).toContain("a.indexes[1].columns");
    expect(paths).toContain("b.indexes[0]");
  });

  it("rejects nullable primary keys, duplicate columns, and bad defaults", () => {
    const issues = validateSchema({
      t: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true, is_nullable: true },
          { c_name: "id", c_type: "text" },
          { c_name: "nick", c_type: "text", is_unique: "yes", default: { odd: true } },
        ],
      },
    });
    const paths = issues.map((i) => i.path);
    expect(paths).toContain("t.columns[2].is_unique");
    expect(paths).toContain("t.columns[2].default");
    expect(issues.length).toBeGreaterThanOrEqual(4);
  });
});
