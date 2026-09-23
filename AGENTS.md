# AGENTS.md — easyql

## Intent
JSON schema (`schema.json`) → validated SQLite DDL. Pipeline: `schema.json → Validator → SQL Generator → valid SQLite SQL`.

## Commands (bun only)
- `bun install` — install
- `bun run src/index.ts [schema.json]` — validate + print DDL (`bun run generate`)
- `bun run src/index.ts diff|seed|validate|init` — migrate, seed, check, scaffold; `--version` prints version
- `bun run build` — tsup → `dist/` (gitignored): dual ESM+CJS lib + node CLI; verified by `node scripts/smoke-dist.mjs` + `bunx attw --pack .`
- `bunx tsc --noEmit` — typecheck
- `bunx vitest run` — all tests; `bunx vitest run <file>` — single file
- release: `git tag vX.Y.Z` — CI verifies, compiles per-OS binaries, attaches to GitHub release

## Architecture
- `src/schema/types.ts` — schema shape source of truth; `src/schema/validator.ts` — rejects bad refs/types before generation
- `src/generator/sqlite.ts` — pure schema → DDL string, no DB I/O; `orderTables()` emits referenced tables first, throws on FK cycles
- `src/index.ts` — CLI (validate → generate); `src/mod.ts` — public library entrypoint
- Published npm name is `easyqlite` (`easyql` is taken); repo/GitHub name stays `easyql`
- Only `src/index.ts` may import node builtins — everything reachable from `src/mod.ts` must stay runtime-agnostic (Node/Bun/browser); `node scripts/smoke-dist.mjs` enforces this
- `src/migrate/diff.ts` — `diffSchemas(old, new)` → migration statements + warnings; un-alterable changes rebuild the table (RENAME → CREATE → copy → DROP), cascading to referencing children
- `src/seed/seed.ts` — `validateSeed` + `generateSeedSql`: self-contained JSON rows → parent-first `INSERT`s
- SQLite only — no Postgres/MySQL syntax.

## Schema contract
- Top level: `{ "<table>": { columns: [...], relations?: [...] } }`; `c_type` in `text|integer|real|blob|numeric`
- Column: `{ c_name, c_type, is_primary_key?, is_nullable?, is_unique?, default? }`; default `is_nullable: true`; PK implies `NOT NULL`; `default` is a string/number literal
- Relation (`many_to_one` only): `{ column, references: { table, column }, on_delete? }` → `FOREIGN KEY … ON DELETE …`; `on_delete` in `cascade|set null|set default|restrict|no action`
- Index: `{ columns: [...], unique?, name? }` → `CREATE [UNIQUE] INDEX`; default name `idx_<table>_<cols>`; names are SQLite-global, validator rejects duplicates

## SQLite gotchas
- Quote identifiers (`"..."`); generator handles ordering — keep it that way, don't sort alphabetically
- Generator outputs DDL only; runtime needs `PRAGMA foreign_keys = ON` for FKs to enforce
