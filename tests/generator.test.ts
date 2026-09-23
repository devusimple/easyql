import { describe, expect, it } from "vitest";
import { generateSQLite } from "../src/generator/sqlite.ts";

describe("generateSQLite", () => {
  it("emits users before posts with FK + cascade", () => {
    const sql = generateSQLite({
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
      users: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "name", c_type: "text", is_nullable: false },
        ],
      },
    });

    expect(sql.indexOf('"users"')).toBeLessThan(sql.indexOf('"posts"'));
    expect(sql).toContain(
      'FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE',
    );
    expect(sql).toMatchSnapshot();
  });

  it("renders UNIQUE and DEFAULT (strings escaped, numbers bare)", () => {
    const sql = generateSQLite({
      users: {
        columns: [
          { c_name: "id", c_type: "integer", is_primary_key: true },
          { c_name: "email", c_type: "text", is_nullable: false, is_unique: true },
          { c_name: "nick", c_type: "text", default: "o'brien" },
          { c_name: "score", c_type: "integer", default: 0 },
        ],
      },
    });

    expect(sql).toContain('"email" TEXT NOT NULL UNIQUE');
    expect(sql).toContain(`"nick" TEXT DEFAULT 'o''brien'`);
    expect(sql).toContain('"score" INTEGER DEFAULT 0');
  });

  it("emits CREATE INDEX after tables, with auto names and composite UNIQUE", () => {
    const sql = generateSQLite({
      posts: {
        columns: [
          { c_name: "id", c_type: "text", is_primary_key: true },
          { c_name: "user_id", c_type: "text", is_nullable: false },
          { c_name: "slug", c_type: "text", is_nullable: false },
        ],
        indexes: [
          { columns: ["user_id"] },
          { columns: ["user_id", "slug"], unique: true, name: "uq_posts_user_slug" },
        ],
      },
    });

    expect(sql).toContain(
      'CREATE INDEX "idx_posts_user_id" ON "posts" ("user_id");',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "uq_posts_user_slug" ON "posts" ("user_id", "slug");',
    );
    // Tables first, indexes last.
    expect(sql.indexOf("CREATE TABLE")).toBeLessThan(sql.indexOf("CREATE INDEX"));
  });
});
