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
});
