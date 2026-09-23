import { describe, expect, it } from "vitest";
import * as mod from "../src/mod.ts";

describe("public entrypoint", () => {
  it("exposes the validator → generator pipeline", () => {
    expect(typeof mod.validateSchema).toBe("function");
    expect(typeof mod.assertValidSchema).toBe("function");
    expect(typeof mod.generateSQLite).toBe("function");
    expect(typeof mod.orderTables).toBe("function");

    const schema = {
      users: {
        columns: [{ c_name: "id", c_type: "text", is_primary_key: true }],
      },
    };
    mod.assertValidSchema(schema);
    expect(mod.generateSQLite(schema)).toContain('CREATE TABLE "users"');
  });
});
