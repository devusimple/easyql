# easyql

JSON schema → validated SQLite DDL.

```
schema.json → Validator → SQL Generator → valid SQLite SQL
```

## Usage

```bash
bun install
bun run src/index.ts [schema.json] [-o out.sql]
```

## Schema shape (`schema.json`)

```json
{
  "users": {
    "columns": [
      { "c_name": "id", "c_type": "text", "is_primary_key": true },
      { "c_name": "email", "c_type": "text", "is_nullable": false, "is_unique": true },
      { "c_name": "nick", "c_type": "text", "default": "anon" }
    ]
  },
  "posts": {
    "columns": [
      { "c_name": "id", "c_type": "text", "is_primary_key": true },
      { "c_name": "user_id", "c_type": "text", "is_nullable": false }
    ],
    "relations": [
      {
        "type": "many_to_one",
        "column": "user_id",
        "references": { "table": "users", "column": "id" },
        "on_delete": "cascade"
      }
    ]
  }
}
```

- `c_type`: `text | integer | real | blob | numeric`
- `is_nullable` defaults to `true`; primary keys are always `NOT NULL`
- `default`: string or number literal
- relations: `many_to_one` only; `on_delete`: `cascade | set null | set default | restrict | no action`

The validator rejects unknown table/column references, bad types, nullable
primary keys, and bad `on_delete` values before any SQL is generated.

## Notes

- Output is DDL only. At runtime, enable `PRAGMA foreign_keys = ON` or
  foreign keys won't be enforced by SQLite.
- Tables are emitted dependency-first; circular FK dependencies are an error.

## Dev

```bash
bunx tsc --noEmit   # typecheck
bunx vitest run     # tests (incl. executing generated DDL on real SQLite)
```
