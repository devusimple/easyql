import { readFileSync } from "node:fs";
import { assertValidSchema } from "./schema/validator.ts";
import { generateSQLite } from "./generator/sqlite.ts";

const schemaPath = process.argv[2] ?? "schema.json";

const raw = readFileSync(schemaPath, "utf8");
const parsed: unknown = JSON.parse(raw);

assertValidSchema(parsed);
process.stdout.write(generateSQLite(parsed));
