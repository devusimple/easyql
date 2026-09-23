import {
  columnDef,
  createIndexStatement,
  createTableStatement,
  orderTables,
  quoteIdent,
  resolveIndexName,
} from "../generator/sqlite.ts";
import type { DatabaseSchema, SchemaColumn, SchemaIndex, SchemaRelation } from "../schema/types.ts";

export interface SchemaDiff {
  statements: string[];
  warnings: string[];
}

function sameColumn(a: SchemaColumn, b: SchemaColumn): boolean {
  return (
    a.c_type.toLowerCase() === b.c_type.toLowerCase() &&
    (a.is_primary_key ?? false) === (b.is_primary_key ?? false) &&
    (a.is_nullable ?? true) === (b.is_nullable ?? true) &&
    (a.is_unique ?? false) === (b.is_unique ?? false) &&
    (a.default ?? null) === (b.default ?? null)
  );
}

function sameIndex(a: SchemaIndex, b: SchemaIndex): boolean {
  return (
    JSON.stringify(a.columns) === JSON.stringify(b.columns) &&
    (a.unique ?? false) === (b.unique ?? false)
  );
}

function relKey(r: SchemaRelation): string {
  return `${r.column}->${r.references.table}(${r.references.column})`;
}

/**
 * An added UNIQUE column can't arrive via ADD COLUMN (SQLite rejects it).
 * Returns the plain column definition plus, unless the new schema already
 * declares a unique index covering exactly this column, a CREATE UNIQUE
 * INDEX statement under a `uq_` name that can't collide with declared
 * `idx_` defaults.
 */
function uniqueColumnMigration(
  table: string,
  col: SchemaColumn,
  declared: SchemaIndex[],
): { column: string; index?: { name: string; statement: string } } {
  const plain = columnDef({ ...col, is_unique: false }, false);
  const covered = declared.some(
    (ix) => (ix.unique ?? false) && ix.columns.length === 1 && ix.columns[0] === col.c_name,
  );
  if (covered) return { column: plain };
  const name = `uq_${table}_${col.c_name}`;
  return {
    column: plain,
    index: {
      name,
      statement: `CREATE UNIQUE INDEX ${quoteIdent(name)} ON ${quoteIdent(table)} (${quoteIdent(col.c_name)});`,
    },
  };
}

/**
 * Diff two schemas into SQLite migration statements. SQLite can't add/drop
 * foreign keys or alter columns via ALTER TABLE, so those become warnings
 * (table rebuild required) instead of statements.
 */
export function diffSchemas(oldSchema: DatabaseSchema, newSchema: DatabaseSchema): SchemaDiff {
  const statements: string[] = [];
  const warnings: string[] = [];
  // Unique-index names already emitted while migrating added UNIQUE columns.
  const emittedIndexNames = new Set<string>();

  for (const table of Object.keys(oldSchema)) {
    if (!(table in newSchema)) statements.push(`DROP TABLE ${quoteIdent(table)};`);
  }

  const addedTables = orderTables(newSchema).filter((t) => !(t in oldSchema));
  for (const table of addedTables) {
    statements.push(createTableStatement(table, newSchema[table]));
  }
  for (const table of addedTables) {
    for (const index of newSchema[table].indexes ?? []) {
      statements.push(createIndexStatement(table, index));
    }
  }

  for (const table of Object.keys(newSchema)) {
    if (!(table in oldSchema)) continue;
    const oldDef = oldSchema[table];
    const newDef = newSchema[table];
    const oldCols = new Map(oldDef.columns.map((c) => [c.c_name, c]));
    const newCols = new Map(newDef.columns.map((c) => [c.c_name, c]));
    const inlinePk = newDef.columns.filter((c) => c.is_primary_key).length === 1;

    for (const [name, col] of newCols) {
      if (!oldCols.has(name)) {
        if (col.is_primary_key) {
          warnings.push(`${table}.${name}: added primary key needs a table rebuild — not emitted`);
        } else if (col.is_unique) {
          // SQLite refuses ADD COLUMN with a UNIQUE constraint, so the column
          // goes in plain and uniqueness arrives as its own index — unless the
          // new schema already declares a unique index covering just it.
          const { column, index } = uniqueColumnMigration(table, col, newDef.indexes ?? []);
          statements.push(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${column};`);
          if (index !== undefined && !emittedIndexNames.has(index.name)) {
            emittedIndexNames.add(index.name);
            statements.push(index.statement);
          }
        } else {
          statements.push(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${columnDef(col, inlinePk)};`);
        }
      } else if (!sameColumn(oldCols.get(name)!, col)) {
        warnings.push(`${table}.${name}: column changed, SQLite needs a table rebuild — not emitted`);
      }
    }
    for (const name of oldCols.keys()) {
      if (!newCols.has(name)) {
        statements.push(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN ${quoteIdent(name)};`);
      }
    }

    const oldRels = new Set((oldDef.relations ?? []).map(relKey));
    const newRels = new Set((newDef.relations ?? []).map(relKey));
    for (const rel of newDef.relations ?? []) {
      if (!oldRels.has(relKey(rel))) {
        warnings.push(`${table}.${rel.column}: added foreign key needs a table rebuild — not emitted`);
      }
    }
    for (const rel of oldDef.relations ?? []) {
      if (!newRels.has(relKey(rel))) {
        warnings.push(`${table}.${rel.column}: dropped foreign key needs a table rebuild — not emitted`);
      }
    }

    const oldIdx = new Map((oldDef.indexes ?? []).map((ix) => [resolveIndexName(table, ix), ix]));
    const newIdx = new Map((newDef.indexes ?? []).map((ix) => [resolveIndexName(table, ix), ix]));
    for (const [name, ix] of newIdx) {
      if (emittedIndexNames.has(name)) continue;
      if (!oldIdx.has(name)) {
        statements.push(createIndexStatement(table, ix));
      } else if (!sameIndex(oldIdx.get(name)!, ix)) {
        statements.push(`DROP INDEX ${quoteIdent(name)};`);
        statements.push(createIndexStatement(table, ix));
      }
    }
    for (const name of oldIdx.keys()) {
      if (!newIdx.has(name)) statements.push(`DROP INDEX ${quoteIdent(name)};`);
    }
  }

  return { statements, warnings };
}
