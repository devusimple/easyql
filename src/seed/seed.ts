import { orderTables, quoteIdent } from "../generator/sqlite.ts";
import type { DatabaseSchema, SchemaColumn } from "../schema/types.ts";

export type SeedValue = string | number | null;
export type SeedRow = Record<string, SeedValue>;
export type SeedData = Record<string, SeedRow[]>;

export interface SeedIssue {
  path: string;
  message: string;
}

/** A column may be omitted only when the database can fill it in. */
function mayOmit(col: SchemaColumn): boolean {
  if (col.default !== undefined) return true;
  return !col.is_primary_key && (col.is_nullable ?? true);
}

function checkValue(col: SchemaColumn, value: SeedValue): string | null {
  if (value === null) {
    return !col.is_primary_key && (col.is_nullable ?? true)
      ? null
      : `null into NOT NULL column "${col.c_name}"`;
  }
  switch (col.c_type.toLowerCase()) {
    case "text":
      return typeof value === "string" ? null : `expected string for text column "${col.c_name}"`;
    case "integer":
      return typeof value === "number" && Number.isInteger(value)
        ? null
        : `expected integer for integer column "${col.c_name}"`;
    case "real":
    case "numeric":
      return typeof value === "number" ? null : `expected number for ${col.c_type} column "${col.c_name}"`;
    case "blob":
      return `seeding blob column "${col.c_name}" is not supported`;
    default:
      return `unknown column type "${col.c_type}"`;
  }
}

/**
 * Seeds must be self-contained: every non-null foreign key must resolve to a
 * row within the seed data itself.
 */
export function validateSeed(schema: DatabaseSchema, data: unknown): SeedIssue[] {
  const issues: SeedIssue[] = [];

  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return [{ path: "$", message: "seed data must be an object of table → rows" }];
  }

  const tables = data as Record<string, unknown>;
  for (const [table, rows] of Object.entries(tables)) {
    const def = schema[table];
    if (!def) {
      issues.push({ path: table, message: `unknown table "${table}"` });
      continue;
    }
    if (!Array.isArray(rows)) {
      issues.push({ path: table, message: "rows must be an array" });
      continue;
    }
    const cols = new Map(def.columns.map((c) => [c.c_name, c]));
    rows.forEach((row: unknown, i: number) => {
      const rowPath = `${table}[${i}]`;
      if (typeof row !== "object" || row === null || Array.isArray(row)) {
        issues.push({ path: rowPath, message: "row must be an object" });
        return;
      }
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        const col = cols.get(key);
        if (!col) {
          issues.push({ path: `${rowPath}.${key}`, message: `unknown column "${key}"` });
          continue;
        }
        if (typeof value !== "string" && typeof value !== "number" && value !== null) {
          issues.push({ path: `${rowPath}.${key}`, message: "value must be a string, number, or null" });
          continue;
        }
        const problem = checkValue(col, value);
        if (problem) issues.push({ path: `${rowPath}.${key}`, message: problem });
      }
      for (const col of def.columns) {
        if (!(col.c_name in (row as Record<string, unknown>)) && !mayOmit(col)) {
          issues.push({ path: rowPath, message: `missing required column "${col.c_name}"` });
        }
      }
    });
  }

  // FK resolution within the seed data.
  const valuesByColumn = new Map<string, Set<SeedValue>>();
  for (const [table, rows] of Object.entries(tables)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (typeof row !== "object" || row === null) continue;
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (typeof value !== "string" && typeof value !== "number" && value !== null) continue;
        const set = valuesByColumn.get(`${table}.${key}`) ?? new Set<SeedValue>();
        set.add(value);
        valuesByColumn.set(`${table}.${key}`, set);
      }
    }
  }
  for (const [table, rows] of Object.entries(tables)) {
    const def = schema[table];
    if (!def || !Array.isArray(rows)) continue;
    rows.forEach((row: unknown, i: number) => {
      if (typeof row !== "object" || row === null) return;
      const record = row as Record<string, unknown>;
      for (const rel of def.relations ?? []) {
        const value = record[rel.column];
        if (value === null || value === undefined) continue;
        if (typeof value !== "string" && typeof value !== "number") continue;
        const candidates = valuesByColumn.get(`${rel.references.table}.${rel.references.column}`);
        if (!candidates?.has(value)) {
          issues.push({
            path: `${table}[${i}].${rel.column}`,
            message: `dangling foreign key: no ${rel.references.table}.${rel.references.column} = ${JSON.stringify(value)} in seed data`,
          });
        }
      }
    });
  }

  return issues;
}

export function assertValidSeed(schema: DatabaseSchema, data: unknown): asserts data is SeedData {
  const issues = validateSeed(schema, data);
  if (issues.length > 0) {
    throw new Error(
      `Invalid seed data:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`,
    );
  }
}

function literal(value: SeedValue): string {
  if (value === null) return "NULL";
  return typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : String(value);
}

export function generateSeedSql(schema: DatabaseSchema, data: SeedData): string {
  const statements: string[] = [];

  for (const table of orderTables(schema)) {
    const rows = data[table];
    if (!rows || rows.length === 0) continue;
    const columns: string[] = [];
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!columns.includes(key)) columns.push(key);
      }
    }
    const values = rows
      .map((row) => `(${columns.map((c) => literal(row[c] ?? null)).join(", ")})`)
      .join(",\n  ");
    statements.push(
      `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) VALUES\n  ${values};`,
    );
  }

  return statements.join("\n") + (statements.length > 0 ? "\n" : "");
}
