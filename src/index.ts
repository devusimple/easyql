#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { helpText, parseArgs } from "./cli.ts";
import { generateSQLite } from "./generator/sqlite.ts";
import { assertValidSchema } from "./schema/validator.ts";

function fail(message: string): never {
  process.stderr.write(`easyql: ${message}\n`);
  process.exit(1);
}

const parsed = parseArgs(process.argv.slice(2));
if ("error" in parsed) fail(`${parsed.error}\nRun with --help for usage.`);
if (parsed.help) {
  process.stdout.write(helpText());
  process.exit(0);
}

let raw: string;
try {
  raw = readFileSync(parsed.input, "utf8");
} catch {
  fail(`cannot read "${parsed.input}"`);
}

let json: unknown;
try {
  json = JSON.parse(raw);
} catch (e) {
  fail(`invalid JSON in "${parsed.input}": ${(e as Error).message}`);
}

try {
  assertValidSchema(json);
} catch (e) {
  fail((e as Error).message);
}

const sql = generateSQLite(json);

if (parsed.output) {
  writeFileSync(parsed.output, sql);
} else {
  process.stdout.write(sql);
}
