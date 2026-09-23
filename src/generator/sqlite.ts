import type { DatabaseSchema, SchemaColumn, SchemaIndex, SchemaRelation, SchemaTable } from "../schema/types.ts";

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sqlType(cType: string): string {
  return cType.toUpperCase();
}

function defaultSql(value: string | number): string {
  return typeof value === "string" ? `'${value.replace(/'/g, "''")}'` : String(value);
}

function onDeleteSql(action: string | undefined): string {
  if (!action) return "";
  return ` ON DELETE ${action.toUpperCase()}`;
}

export function referencesClause(rel: SchemaRelation): string {
  return ` REFERENCES ${quoteIdent(rel.references.table)}(${quoteIdent(rel.references.column)})${onDeleteSql(rel.on_delete)}`;
}

/** Order tables so referenced tables are created first. Throws on cycles. */
export function orderTables(schema: DatabaseSchema): string[] {
  const visited = new Map<string, "temp" | "perm">();
  const result: string[] = [];

  function visit(table: string, stack: string[]): void {
    const state = visited.get(table);
    if (state === "perm") return;
    if (state === "temp") {
      throw new Error(`Circular foreign key dependency: ${[...stack, table].join(" -> ")}`);
    }
    visited.set(table, "temp");
    for (const rel of schema[table].relations ?? []) {
      const target = rel.references.table;
      if (target in schema) visit(target, [...stack, table]);
    }
    visited.set(table, "perm");
    result.push(table);
  }

  for (const table of Object.keys(schema)) visit(table, []);
  return result;
}

export function columnDef(col: SchemaColumn, inlinePk: boolean): string {
  const nullable = col.is_primary_key ? false : (col.is_nullable ?? true);
  let line = `${quoteIdent(col.c_name)} ${sqlType(col.c_type)}`;
  if (inlinePk && col.is_primary_key) line += " PRIMARY KEY";
  if (!nullable && !(inlinePk && col.is_primary_key)) line += " NOT NULL";
  if (col.is_unique) line += " UNIQUE";
  if (col.default !== undefined) line += ` DEFAULT ${defaultSql(col.default)}`;
  return line;
}

export function createTableStatement(table: string, def: SchemaTable): string {
  const pkCols = def.columns.filter((c) => c.is_primary_key).map((c) => c.c_name);
  const inlinePk = pkCols.length === 1;

  const lines: string[] = def.columns.map((col) => `  ${columnDef(col, inlinePk)}`);

  if (pkCols.length > 1) {
    lines.push(`  PRIMARY KEY (${pkCols.map(quoteIdent).join(", ")})`);
  }

  for (const rel of def.relations ?? []) {
    lines.push(
      `  FOREIGN KEY (${quoteIdent(rel.column)}) REFERENCES ${quoteIdent(rel.references.table)}(${quoteIdent(rel.references.column)})${onDeleteSql(rel.on_delete)}`,
    );
  }

  return `CREATE TABLE ${quoteIdent(table)} (\n${lines.join(",\n")}\n);`;
}

/** Index names live in one SQLite-global namespace; the default keeps them unique. */
export function resolveIndexName(table: string, index: SchemaIndex): string {
  return index.name ?? `idx_${table}_${index.columns.join("_")}`;
}

export function createIndexStatement(table: string, index: SchemaIndex): string {
  const unique = index.unique ? "UNIQUE " : "";
  const cols = index.columns.map(quoteIdent).join(", ");
  return `CREATE ${unique}INDEX ${quoteIdent(resolveIndexName(table, index))} ON ${quoteIdent(table)} (${cols});`;
}

export function generateSQLite(schema: DatabaseSchema): string {
  const statements: string[] = [];

  for (const table of orderTables(schema)) {
    statements.push(createTableStatement(table, schema[table]));
  }
  // Indexes after all tables: a table must exist before it can be indexed.
  for (const table of orderTables(schema)) {
    for (const index of schema[table].indexes ?? []) {
      statements.push(createIndexStatement(table, index));
    }
  }

  return statements.join("\n") + "\n";
}
