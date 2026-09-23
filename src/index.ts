#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { helpText, parseArgs } from "./cli.ts";
import { generateSQLite } from "./generator/sqlite.ts";
import { diffSchemas } from "./migrate/diff.ts";
import { assertValidSchema } from "./schema/validator.ts";
import type { DatabaseSchema } from "./schema/types.ts";

function fail(message: string): never {
  process.stderr.write(`easyql: ${message}\n`);
  process.exit(1);
}

function emit(sql: string, output: string | undefined): void {
  if (output) writeFileSync(output, sql);
  else process.stdout.write(sql);
}

function loadSchema(path: string): DatabaseSchema {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    fail(`cannot read "${path}"`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw!);
  } catch (e) {
    fail(`invalid JSON in "${path}": ${(e as Error).message}`);
  }
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
} else {
  emit(generateSQLite(loadSchema(parsed.input)), parsed.output);
}
