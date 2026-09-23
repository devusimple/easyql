// Public library entrypoint: import easyql programmatically instead of
// shelling out to the CLI (see src/index.ts).
export type {
  ColumnType,
  DatabaseSchema,
  OnDeleteAction,
  RelationType,
  SchemaColumn,
  SchemaIndex,
  SchemaRelation,
  SchemaTable,
} from "./schema/types.ts";
export {
  assertValidSchema,
  validateSchema,
  type ValidationIssue,
} from "./schema/validator.ts";
export {
  columnDef,
  createIndexStatement,
  createTableStatement,
  generateSQLite,
  orderTables,
  quoteIdent,
  resolveIndexName,
} from "./generator/sqlite.ts";
export { helpText, parseArgs, type CliOptions } from "./cli.ts";
export { diffSchemas, type SchemaDiff } from "./migrate/diff.ts";
