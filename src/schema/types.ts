export type ColumnType = "text" | "integer" | "real" | "blob" | "numeric";

export interface SchemaColumn {
  c_name: string;
  c_type: string;
  is_primary_key?: boolean;
  is_nullable?: boolean;
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
}

export type DatabaseSchema = Record<string, SchemaTable>;
