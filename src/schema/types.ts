export type ColumnType = "text" | "integer" | "real" | "blob" | "numeric";

export interface SchemaColumn {
  c_name: string;
  c_type: string;
  is_primary_key?: boolean;
  is_nullable?: boolean;
  is_unique?: boolean;
  /** Column DEFAULT: string or number literal. */
  default?: string | number;
}

export type RelationType = "many_to_one";

export type OnDeleteAction =
  | "cascade"
  | "set null"
  | "set default"
  | "restrict"
  | "no action";

export interface SchemaRelation {
  type: RelationType;
  column: string;
  references: {
    table: string;
    column: string;
  };
  on_delete?: OnDeleteAction | string;
}

export interface SchemaTable {
  columns: SchemaColumn[];
  relations?: SchemaRelation[];
  indexes?: SchemaIndex[];
}

export interface SchemaIndex {
  /** Indexed columns. Multiple columns = composite index (unique = composite UNIQUE). */
  columns: string[];
  unique?: boolean;
  /** Defaults to idx_<table>_<col1>_<col2>. */
  name?: string;
}

export type DatabaseSchema = Record<string, SchemaTable>;
