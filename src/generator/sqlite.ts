import type { DatabaseSchema } from "../schema/types.ts";

function quoteIdent(name: string): string {
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

export function generateSQLite(schema: DatabaseSchema): string {
  const statements: string[] = [];

  for (const table of orderTables(schema)) {
    const def = schema[table];
    const pkCols = def.columns.filter((c) => c.is_primary_key).map((c) => c.c_name);
    const inlinePk = pkCols.length === 1;

    const lines: string[] = def.columns.map((col) => {
      const nullable = col.is_primary_key ? false : (col.is_nullable ?? true);
      let line = `  ${quoteIdent(col.c_name)} ${sqlType(col.c_type)}`;
      if (inlinePk && col.is_primary_key) line += " PRIMARY KEY";
      if (!nullable && !(inlinePk && col.is_primary_key)) line += " NOT NULL";
      if (col.is_unique) line += " UNIQUE";
      if (col.default !== undefined) line += ` DEFAULT ${defaultSql(col.default)}`;
      return line;
    });

    if (pkCols.length > 1) {
      lines.push(`  PRIMARY KEY (${pkCols.map(quoteIdent).join(", ")})`);
    }

    for (const rel of def.relations ?? []) {
      lines.push(
        `  FOREIGN KEY (${quoteIdent(rel.column)}) REFERENCES ${quoteIdent(rel.references.table)}(${quoteIdent(rel.references.column)})${onDeleteSql(rel.on_delete)}`,
      );
    }

    statements.push(`CREATE TABLE ${quoteIdent(table)} (\n${lines.join(",\n")}\n);`);
  }

  return statements.join("\n") + "\n";
}
