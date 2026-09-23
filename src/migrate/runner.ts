import { diffSchemas } from "./diff.ts";
import { generateSeedStatements } from "../seed/seed.ts";
import { generateStatements } from "../generator/sqlite.ts";
import type { SeedData } from "../seed/seed.ts";
import type { DatabaseSchema } from "../schema/types.ts";

/** Minimal database surface the runner needs. Implemented by connection.ts (CLI-only). */
export interface DbConnection {
  exec(sql: string): void;
  query(sql: string): Record<string, unknown>[];
  close(): void;
}

export type MigrateStatus = "up-to-date" | "fresh" | "migrated" | "baselined";

export interface MigrateResult {
  status: MigrateStatus;
  /** Statements actually applied (empty for up-to-date). */
  applied: string[];
  warnings: string[];
}

export class MigrationError extends Error {
  readonly violations: Record<string, unknown>[];
  constructor(message: string, violations: Record<string, unknown>[]) {
    super(message);
    this.name = "MigrationError";
    this.violations = violations;
  }
}

const JOURNAL_TABLE = "_easyql_migrations";

/** cyrb53: deterministic non-crypto hash, good enough for change detection. */
export function hashSchema(schema: DatabaseSchema): string {
  const normalized = JSON.stringify(sortKeys(schema));
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

function readState(db: DbConnection): { hash: string; schema: DatabaseSchema } | null {
  db.exec(
    `CREATE TABLE IF NOT EXISTS "${JOURNAL_TABLE}" (` +
      `"id" INTEGER PRIMARY KEY CHECK ("id" = 1), ` +
      `"schema_hash" TEXT NOT NULL, ` +
      `"schema_json" TEXT NOT NULL, ` +
      `"applied_at" TEXT NOT NULL);`,
  );
  const rows = db.query(`SELECT "schema_hash", "schema_json" FROM "${JOURNAL_TABLE}" WHERE "id" = 1;`);
  if (rows.length === 0) return null;
  return {
    hash: rows[0]["schema_hash"] as string,
    schema: JSON.parse(rows[0]["schema_json"] as string) as DatabaseSchema,
  };
}

function writeState(db: DbConnection, hash: string, schema: DatabaseSchema): void {
  const json = JSON.stringify(schema).replace(/'/g, "''");
  db.exec(
    `INSERT OR REPLACE INTO "${JOURNAL_TABLE}" ("id", "schema_hash", "schema_json", "applied_at") ` +
      `VALUES (1, '${hash}', '${json}', '${new Date().toISOString()}');`,
  );
}

export interface MigrateInput {
  schema: DatabaseSchema;
  /** Seeds apply to fresh databases only; otherwise skipped with a warning. */
  seedData?: SeedData;
  /** Record the schema as current state without applying anything. */
  baseline?: boolean;
}

/**
 * Bring a database to the given schema. Everything applies inside one
 * transaction with foreign keys off; `PRAGMA foreign_key_check` must come
 * back clean or the transaction rolls back and a MigrationError is thrown.
 */
export function migrateDatabase(db: DbConnection, input: MigrateInput): MigrateResult {
  const { schema, seedData, baseline } = input;
  const hash = hashSchema(schema);
  const stored = readState(db);

  if (stored && stored.hash === hash) {
    return { status: "up-to-date", applied: [], warnings: [] };
  }

  const warnings: string[] = [];
  let statements: string[];

  if (baseline) {
    if (seedData) warnings.push("seed skipped: baseline records state without applying anything");
    db.exec("BEGIN;");
    try {
      writeState(db, hash, schema);
      db.exec("COMMIT;");
    } catch (e) {
      db.exec("ROLLBACK;");
      throw e;
    }
    return { status: "baselined", applied: [], warnings };
  }

  if (stored === null) {
    statements = generateStatements(schema);
    if (seedData) {
      statements.push(...generateSeedStatements(schema, seedData));
    }
  } else {
    const diff = diffSchemas(stored.schema, schema);
    statements = diff.statements;
    warnings.push(...diff.warnings);
    if (seedData) {
      warnings.push("seed skipped: database already initialized (seeds apply to fresh databases only)");
    }
  }

  db.exec("BEGIN;");
  try {
    db.exec("PRAGMA foreign_keys=OFF;");
    for (const sql of statements) db.exec(sql);
    db.exec("PRAGMA foreign_keys=ON;");
    const violations = db.query("PRAGMA foreign_key_check;");
    if (violations.length > 0) {
      db.exec("ROLLBACK;");
      throw new MigrationError(
        `migration would leave ${violations.length} foreign key violation(s), rolled back`,
        violations,
      );
    }
    writeState(db, hash, schema);
    db.exec("COMMIT;");
  } catch (e) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // Already rolled back (violation path) — report the original error.
    }
    throw e;
  }

  return { status: stored === null ? "fresh" : "migrated", applied: statements, warnings };
}
