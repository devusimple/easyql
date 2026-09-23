import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { helpText, parseArgs } from "./cli.ts";
import { generateSQLite } from "./generator/sqlite.ts";
import { diffSchemas } from "./migrate/diff.ts";
import { SCHEMA_TEMPLATE, SEED_TEMPLATE } from "./scaffold.ts";
import { assertValidSeed, generateSeedSql } from "./seed/seed.ts";
import { assertValidSchema } from "./schema/validator.ts";
import type { DatabaseSchema } from "./schema/types.ts";
import pkg from "../package.json";

function fail(message: string): never {
  process.stderr.write(`easyql: ${message}\n`);
  process.exit(1);
}

function emit(sql: string, output: string | undefined): void {
  if (output) writeFileSync(output, sql);
  else process.stdout.write(sql);
}

function loadJson(path: string): unknown {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    fail(`cannot read "${path}"`);
  }
  try {
    return JSON.parse(raw!);
  } catch (e) {
    fail(`invalid JSON in "${path}": ${(e as Error).message}`);
  }
}

function loadSchema(path: string): DatabaseSchema {
  const json = loadJson(path);
  try {
    assertValidSchema(json);
  } catch (e) {
    fail((e as Error).message);
  }
  return json as DatabaseSchema;
}

const parsed = parseArgs(process.argv.slice(2));
if ("error" in parsed) fail(`${parsed.error}\nRun with --help for usage.`);
if (parsed.help) {
  process.stdout.write(helpText());
  process.exit(0);
}

if (parsed.command === "diff") {
  const oldSchema = loadSchema(parsed.old);
  const newSchema = loadSchema(parsed.current);
  const { statements, warnings } = diffSchemas(oldSchema, newSchema);
  for (const warning of warnings) {
    process.stderr.write(`easyql warning: ${warning}\n`);
  }
  emit(statements.join("\n") + (statements.length > 0 ? "\n" : ""), parsed.output);
} else if (parsed.command === "seed") {
  const schema = loadSchema(parsed.schema);
  const data = loadJson(parsed.data);
  try {
    assertValidSeed(schema, data);
  } catch (e) {
    fail((e as Error).message);
  }
  emit(generateSeedSql(schema, data as Parameters<typeof generateSeedSql>[1]), parsed.output);
} else if (parsed.command === "init") {
  mkdirSync(parsed.dir, { recursive: true });
  for (const [name, template] of [["schema.json", SCHEMA_TEMPLATE], ["seed.json", SEED_TEMPLATE]] as const) {
    const path = join(parsed.dir, name);
    if (existsSync(path) && !parsed.force) {
      fail(`"${path}" exists (use -f to overwrite)`);
    }
    writeFileSync(path, template);
    process.stdout.write(`wrote ${path}\n`);
  }
} else if (parsed.command === "validate") {
  const schema = loadSchema(parsed.schema);
  if (parsed.data !== undefined) {
    const data = loadJson(parsed.data);
    try {
      assertValidSeed(schema, data);
    } catch (e) {
      fail((e as Error).message);
    }
  }
} else if (parsed.command === "version") {
  process.stdout.write(`easyql ${(pkg as { version: string }).version}\n`);
} else {
  emit(generateSQLite(loadSchema(parsed.input)), parsed.output);
}
