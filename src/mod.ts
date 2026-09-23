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
  generateStatements,
  orderTables,
  quoteIdent,
  referencesClause,
  resolveIndexName,
} from "./generator/sqlite.ts";
export { helpText, parseArgs, type CliOptions } from "./cli.ts";
export { diffSchemas, type SchemaDiff } from "./migrate/diff.ts";
export {
  MigrationError,
  hashSchema,
  migrateDatabase,
  type DbConnection,
  type MigrateInput,
  type MigrateResult,
  type MigrateStatus,
} from "./migrate/runner.ts";
export {
  assertValidSeed,
  generateSeedSql,
  generateSeedStatements,
  validateSeed,
  type SeedData,
  type SeedIssue,
  type SeedRow,
  type SeedValue,
} from "./seed/seed.ts";
