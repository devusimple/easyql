import type { DatabaseSchema } from "./types.ts";

const VALID_COLUMN_TYPES = new Set(["text", "integer", "real", "blob", "numeric"]);
const VALID_RELATION_TYPES = new Set(["many_to_one"]);
const VALID_ON_DELETE = new Set([
  "cascade",
  "set null",
  "set default",
  "restrict",
  "no action",
]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateSchema(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [{ path: "$", message: "schema must be an object of tables" }];
  }

  const schema = input as Record<string, unknown>;
  const tableNames = Object.keys(schema);

  if (tableNames.length === 0) {
    issues.push({ path: "$", message: "schema must define at least one table" });
    return issues;
  }

  for (const table of tableNames) {
    if (!IDENT.test(table)) {
      issues.push({ path: table, message: `invalid table name "${table}"` });
    }
  }

  for (const [table, rawDef] of Object.entries(schema)) {
    const path = table;
    if (typeof rawDef !== "object" || rawDef === null || Array.isArray(rawDef)) {
      issues.push({ path, message: "table definition must be an object" });
      continue;
    }
    const def = rawDef as Record<string, unknown>;

    if (!Array.isArray(def.columns) || def.columns.length === 0) {
      issues.push({ path: `${path}.columns`, message: "columns must be a non-empty array" });
      continue;
    }

    const seen = new Set<string>();
    const columnNames = new Set<string>();

    def.columns.forEach((rawCol: unknown, i: number) => {
      const colPath = `${path}.columns[${i}]`;
      if (typeof rawCol !== "object" || rawCol === null) {
        issues.push({ path: colPath, message: "column must be an object" });
        return;
      }
      const col = rawCol as Record<string, unknown>;

      if (typeof col.c_name !== "string" || !IDENT.test(col.c_name)) {
        issues.push({ path: `${colPath}.c_name`, message: "c_name must be a valid identifier" });
      } else {
        if (seen.has(col.c_name)) {
          issues.push({ path: `${colPath}.c_name`, message: `duplicate column "${col.c_name}"` });
        }
        seen.add(col.c_name);
        columnNames.add(col.c_name);
      }

      if (typeof col.c_type !== "string" || !VALID_COLUMN_TYPES.has(col.c_type.toLowerCase())) {
        issues.push({
          path: `${colPath}.c_type`,
          message: `c_type must be one of ${[...VALID_COLUMN_TYPES].join(", ")}`,
        });
      }

      for (const flag of ["is_primary_key", "is_nullable", "is_unique"] as const) {
        if (col[flag] !== undefined && typeof col[flag] !== "boolean") {
          issues.push({ path: `${colPath}.${flag}`, message: `${flag} must be a boolean` });
        }
      }

      if (col.default !== undefined && typeof col.default !== "string" && typeof col.default !== "number") {
        issues.push({ path: `${colPath}.default`, message: "default must be a string or number" });
      }

      if (col.is_primary_key === true && col.is_nullable === true) {
        issues.push({
          path: colPath,
          message: "primary key column cannot be nullable",
        });
      }
    });

    // Store for cross-table checks even if some columns were invalid.
    (def as { __columnNames?: Set<string> }).__columnNames = columnNames;

    if (def.relations !== undefined) {
      if (!Array.isArray(def.relations)) {
        issues.push({ path: `${path}.relations`, message: "relations must be an array" });
        continue;
      }
      def.relations.forEach((rawRel: unknown, i: number) => {
        const relPath = `${path}.relations[${i}]`;
        if (typeof rawRel !== "object" || rawRel === null) {
          issues.push({ path: relPath, message: "relation must be an object" });
          return;
        }
        const rel = rawRel as Record<string, unknown>;

        if (typeof rel.type !== "string" || !VALID_RELATION_TYPES.has(rel.type)) {
          issues.push({
            path: `${relPath}.type`,
            message: 'type must be "many_to_one"',
          });
        }
        if (typeof rel.column !== "string" || !columnNames.has(rel.column)) {
          issues.push({
            path: `${relPath}.column`,
            message: `column "${String(rel.column)}" must exist in table "${table}"`,
          });
        }
        const ref = rel.references as Record<string, unknown> | undefined;
        if (typeof ref !== "object" || ref === null) {
          issues.push({ path: `${relPath}.references`, message: "references must be an object" });
        } else {
          if (typeof ref.table !== "string" || !(ref.table in schema)) {
            issues.push({
              path: `${relPath}.references.table`,
              message: `references unknown table "${String(ref.table)}"`,
            });
          }
          if (typeof ref.column !== "string" || ref.column.length === 0) {
            issues.push({
              path: `${relPath}.references.column`,
              message: "references.column must be a non-empty string",
            });
          }
        }
        if (rel.on_delete !== undefined) {
          if (typeof rel.on_delete !== "string" || !VALID_ON_DELETE.has(rel.on_delete.toLowerCase())) {
            issues.push({
              path: `${relPath}.on_delete`,
              message: `on_delete must be one of ${[...VALID_ON_DELETE].join(", ")}`,
            });
          }
        }
      });
    }
  }

  // Second pass: referenced column must exist in the referenced table.
  const typed = input as DatabaseSchema;
  for (const [table, def] of Object.entries(typed)) {
    for (let i = 0; i < (def.relations ?? []).length; i++) {
      const rel = def.relations![i];
      const target = typed[rel.references?.table];
      if (!target || !rel.references) continue;
      const targetCols = new Set(target.columns?.map((c) => c.c_name) ?? []);
      if (!targetCols.has(rel.references.column)) {
        issues.push({
          path: `${table}.relations[${i}].references.column`,
          message: `table "${rel.references.table}" has no column "${rel.references.column}"`,
        });
      }
    }
  }

  return issues;
}

export function assertValidSchema(input: unknown): asserts input is DatabaseSchema {
  const issues = validateSchema(input);
  if (issues.length > 0) {
    throw new Error(
      `Invalid schema:\n${issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`,
    );
  }
}
