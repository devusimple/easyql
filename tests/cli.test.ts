import { describe, expect, it } from "vitest";
import { parseArgs } from "../src/cli.ts";

describe("parseArgs", () => {
  it("defaults to generating schema.json on stdout", () => {
    expect(parseArgs([])).toEqual({ command: "generate", input: "schema.json", output: undefined, help: false });
  });

  it("accepts input, -o, and --help", () => {
    expect(parseArgs(["custom.json", "-o", "out.sql"])).toEqual({
      command: "generate",
      input: "custom.json",
      output: "out.sql",
      help: false,
    });
    expect(parseArgs(["--help"])).toMatchObject({ help: true });
  });

  it("parses the diff subcommand", () => {
    expect(parseArgs(["diff", "v1.json", "v2.json"])).toEqual({
      command: "diff",
      old: "v1.json",
      current: "v2.json",
      output: undefined,
      help: false,
    });
    expect(parseArgs(["diff", "only-one.json"])).toHaveProperty("error");
  });

  it("parses the seed subcommand", () => {
    expect(parseArgs(["seed", "schema.json", "seed.json"])).toEqual({
      command: "seed",
      schema: "schema.json",
      data: "seed.json",
      output: undefined,
      help: false,
    });
    expect(parseArgs(["seed", "only-one.json"])).toHaveProperty("error");
  });

  it("parses init, validate, and --version", () => {
    expect(parseArgs(["init"])).toEqual({ command: "init", dir: ".", force: false, help: false });
    expect(parseArgs(["init", "db", "-f"])).toMatchObject({ command: "init", dir: "db", force: true });
    expect(parseArgs(["validate", "schema.json"])).toMatchObject({ command: "validate" });
    expect(parseArgs(["validate"])).toHaveProperty("error");
    expect(parseArgs(["--version"])).toEqual({ command: "version", help: false });
  });

  it("parses migrate and rejects misplaced migrate-only flags", () => {
    expect(parseArgs(["migrate", "schema.json", "--db", "app.db"])).toEqual({
      command: "migrate",
      schema: "schema.json",
      db: "app.db",
      seed: undefined,
      baseline: false,
      output: undefined,
      help: false,
    });
    expect(parseArgs(["migrate", "schema.json"])).toHaveProperty("error");
    expect(parseArgs(["schema.json", "--db", "app.db"])).toHaveProperty("error");
    expect(parseArgs(["validate", "schema.json", "--baseline"])).toHaveProperty("error");
  });

  it("rejects unknown flags, missing values, and extra positionals", () => {
    expect(parseArgs(["--frobnicate"])).toHaveProperty("error");
    expect(parseArgs(["-o"])).toHaveProperty("error");
    expect(parseArgs(["a.json", "b.json"])).toHaveProperty("error");
  });
});
