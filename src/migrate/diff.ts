import {
  columnDef,
  createIndexStatement,
  createTableStatement,
  orderTables,
  quoteIdent,
  referencesClause,
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
  refs: SchemaRelation[],
  declared: SchemaIndex[],
): { column: string; index?: { name: string; statement: string }; extraWarnings: string[] } {
  const refSql = refs.length > 0 ? referencesClause(refs[0]) : "";
  const extraWarnings = refs.slice(1).map(
    (r) => `${table}.${r.column}: only one inline foreign key per column — ${relKey(r)} needs a table rebuild, not emitted`,
  );
  const plain = columnDef({ ...col, is_unique: false }, false) + refSql;
  const covered = declared.some(
    (ix) => (ix.unique ?? false) && ix.columns.length === 1 && ix.columns[0] === col.c_name,
  );
  if (covered) return { column: plain, extraWarnings };
  const name = `uq_${table}_${col.c_name}`;
  return {
    column: plain,
    index: {
      name,
      statement: `CREATE UNIQUE INDEX ${quoteIdent(name)} ON ${quoteIdent(table)} (${quoteIdent(col.c_name)});`,
    },
    extraWarnings,
  };
}

function backupName(table: string, schemas: DatabaseSchema[]): string {
  const taken = new Set(schemas.flatMap((s) => Object.keys(s)));
  let name = `_easyql_backup_${table}`;
  for (let i = 2; taken.has(name); i++) name = `_easyql_backup_${table}_${i}`;
  return name;
}

/**
 * Diff two schemas into runnable SQLite migration statements.
 *
 * SQLite ALTER TABLE can't add/drop table-level foreign keys, alter columns,
 * add primary keys, or drop risky columns (PK/UNIQUE/indexed/FK targets), so
 * those tables are rebuilt: RENAME → CREATE → copy shared columns → DROP →
 * recreate indexes. Rebuilding a parent also rebuilds tables that reference
 * it, otherwise their REFERENCES would dangle at the backup name.
 *
 * Run the output with foreign keys off (emitted PRAGMAs do that when a
 * rebuild is present), ideally inside a transaction.
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

  // Columns that are FK targets in the old schema can't be dropped in place.
  const oldFkTargets = new Set<string>();
  for (const [table, def] of Object.entries(oldSchema)) {
    for (const rel of def.relations ?? []) {
      oldFkTargets.add(`${rel.references.table}.${rel.references.column}`);
    }
  }

  // Seed the rebuild set, then cascade to tables referencing a rebuilt table.
  const rebuild = new Set<string>();
  for (const table of Object.keys(newSchema)) {
    if (!(table in oldSchema)) continue;
    const oldDef = oldSchema[table];
    const newDef = newSchema[table];
    const oldCols = new Map(oldDef.columns.map((c) => [c.c_name, c]));
    const newColNames = new Set(newDef.columns.map((c) => c.c_name));
    const oldIndexed = new Set((oldDef.indexes ?? []).flatMap((ix) => ix.columns));
    const oldRels = new Set((oldDef.relations ?? []).map(relKey));
    const newRels = new Set((newDef.relations ?? []).map(relKey));

    const changed = newDef.columns.some(
      (c) => oldCols.has(c.c_name) && !sameColumn(oldCols.get(c.c_name)!, c),
    );
    const addedPk = newDef.columns.some((c) => !oldCols.has(c.c_name) && c.is_primary_key);
    const fkOnExisting = (newDef.relations ?? []).some(
      (r) => !oldRels.has(relKey(r)) && oldCols.has(r.column),
    );
    const fkDropped = (oldDef.relations ?? []).some(
      (r) => !newRels.has(relKey(r)) && newColNames.has(r.column),
    );
    const riskyDrop = [...oldCols.keys()].some(
      (n) =>
        !newColNames.has(n) &&
        (oldCols.get(n)!.is_primary_key ||
          oldCols.get(n)!.is_unique ||
          oldIndexed.has(n) ||
          oldFkTargets.has(`${table}.${n}`)),
    );
    if (changed || addedPk || fkOnExisting || fkDropped || riskyDrop) rebuild.add(table);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const [table, def] of Object.entries(oldSchema)) {
      if (table in newSchema && !rebuild.has(table)) {
        const pointsAtRebuild = (def.relations ?? []).some((r) => rebuild.has(r.references.table));
        if (pointsAtRebuild) {
          rebuild.add(table);
          grew = true;
        }
      }
    }
  }

  // Incremental changes for tables that survive in place.
  for (const table of Object.keys(newSchema)) {
    if (!(table in oldSchema) || rebuild.has(table)) continue;
    const oldDef = oldSchema[table];
    const newDef = newSchema[table];
    const oldCols = new Map(oldDef.columns.map((c) => [c.c_name, c]));
    const newCols = new Map(newDef.columns.map((c) => [c.c_name, c]));
    const inlinePk = newDef.columns.filter((c) => c.is_primary_key).length === 1;
    const oldRels = new Set((oldDef.relations ?? []).map(relKey));
    const addedRelByColumn = new Map<string, SchemaRelation[]>();
    for (const rel of newDef.relations ?? []) {
      if (oldRels.has(relKey(rel))) continue;
      const list = addedRelByColumn.get(rel.column) ?? [];
      list.push(rel);
      addedRelByColumn.set(rel.column, list);
    }

    for (const [name, col] of newCols) {
      if (oldCols.has(name)) continue;
      const refs = addedRelByColumn.get(name) ?? [];
      if (col.is_unique) {
        const m = uniqueColumnMigration(table, col, refs, newDef.indexes ?? []);
        statements.push(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${m.column};`);
        warnings.push(...m.extraWarnings);
        if (m.index !== undefined && !emittedIndexNames.has(m.index.name)) {
          emittedIndexNames.add(m.index.name);
          statements.push(m.index.statement);
        }
      } else {
        const refSql = refs.length > 0 ? referencesClause(refs[0]) : "";
        for (const r of refs.slice(1)) {
          warnings.push(`${table}.${r.column}: only one inline foreign key per column — ${relKey(r)} needs a table rebuild, not emitted`);
        }
        statements.push(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN ${columnDef(col, inlinePk)}${refSql};`);
      }
    }
    for (const name of oldCols.keys()) {
      if (!newCols.has(name)) {
        statements.push(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN ${quoteIdent(name)};`);
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

  // Rebuild blocks, parents before children.
  const rebuildBlocks: string[] = [];
  for (const table of orderTables(newSchema)) {
    if (!rebuild.has(table)) continue;
    const oldDef = oldSchema[table];
    const newDef = newSchema[table];
    const oldCols = new Set(oldDef.columns.map((c) => c.c_name));
    const shared = newDef.columns.map((c) => c.c_name).filter((n) => oldCols.has(n));
    const backup = backupName(table, [oldSchema, newSchema]);

    rebuildBlocks.push(`ALTER TABLE ${quoteIdent(table)} RENAME TO ${quoteIdent(backup)};`);
    rebuildBlocks.push(createTableStatement(table, newDef));
    if (shared.length > 0) {
      const list = shared.map(quoteIdent).join(", ");
      rebuildBlocks.push(`INSERT INTO ${quoteIdent(table)} (${list}) SELECT ${list} FROM ${quoteIdent(backup)};`);
    }
    rebuildBlocks.push(`DROP TABLE ${quoteIdent(backup)};`);
    for (const index of newDef.indexes ?? []) {
      rebuildBlocks.push(createIndexStatement(table, index));
    }
  }

  if (rebuildBlocks.length > 0) {
    return {
      statements: [`PRAGMA foreign_keys=OFF;`, ...statements, ...rebuildBlocks, `PRAGMA foreign_keys=ON;`],
      warnings,
    };
  }
  return { statements, warnings };
}
