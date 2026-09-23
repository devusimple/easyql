import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.ts";

describe("parseArgs", () => {
  it("defaults to schema.json on stdout", () => {
    expect(parseArgs([])).toEqual({ input: "schema.json", output: undefined, help: false });
  });

  it("accepts input, -o, and --help", () => {
    expect(parseArgs(["custom.json", "-o", "out.sql"])).toEqual({
      input: "custom.json",
      output: "out.sql",
      help: false,
    });
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
  });

  it("rejects unknown flags, missing values, and extra positionals", () => {
    expect(parseArgs(["--frobnicate"])).toHaveProperty("error");
    expect(parseArgs(["-o"])).toHaveProperty("error");
    expect(parseArgs(["a.json", "b.json"])).toHaveProperty("error");
  });
});
