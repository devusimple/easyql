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

Installed as a dependency, the `easyql` bin is available (`bunx easyql schema.json`).

## Migrations

```bash
bun run src/index.ts diff old.json new.json [-o migration.sql]
```

Emits `CREATE/DROP TABLE`, `ADD/DROP COLUMN`, and `CREATE/DROP INDEX`
statements. What SQLite `ALTER TABLE` can't do (added/dropped foreign keys,
changed columns, added primary keys) is reported as a warning on stderr —
those need a table rebuild.

## Programmatic use

```ts
import { assertValidSchema, generateSQLite } from "easyql/src/mod.ts";

assertValidSchema(schemaJson);
const ddl = generateSQLite(schemaJson);
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
- `indexes`: `{ columns, unique?, name? }` → emitted as `CREATE [UNIQUE] INDEX`
  after all tables; default name `idx_<table>_<cols>` (composite columns =
  composite UNIQUE)

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

## Releases

Push a tag (`git tag v0.1.0 && git push origin v0.1.0`) — CI verifies,
compiles a standalone binary per OS via `bun build --compile`, and attaches
them to the GitHub release. The npm package stays private; binaries are the
distribution.
