import { createRequire } from "node:module";
import { join } from "node:path";
import { cwd } from "node:process";
import type { DbConnection } from "./runner.ts";

// Resolved lazily from the working directory (never statically imported, so
// the published library entry stays free of node builtins and bundles for
// browsers) and never via import.meta, which is empty in the CJS CLI bundle.
// This module is CLI-only.
const require = createRequire(join(cwd(), "package.json"));

function tryBun(path: string): DbConnection | null {
  try {
    const { Database } = require("bun:sqlite") as {
      Database: new (path: string) => {
        exec(sql: string): void;
        query(sql: string): { all(...p: unknown[]): Record<string, unknown>[] };
        close(): void;
      };
    };
    const db = new Database(path);
    return {
      exec: (sql) => db.exec(sql),
      query: (sql) => db.query(sql).all(),
      close: () => db.close(),
    };
  } catch {
    return null;
  }
}

function tryNode(path: string): DbConnection | null {
  try {
    const { DatabaseSync } = require("node:sqlite") as {
      DatabaseSync: new (path: string) => {
        exec(sql: string): void;
        prepare(sql: string): { all(...p: unknown[]): Record<string, unknown>[] };
        close(): void;
      };
    };
    const db = new DatabaseSync(path);
    return {
      exec: (sql) => db.exec(sql),
      query: (sql) => db.prepare(sql).all(),
      close: () => db.close(),
    };
  } catch {
    return null;
  }
}

export function openDatabase(path: string): DbConnection {
  return (
    tryBun(path) ??
    tryNode(path) ??
    (() => {
      throw new Error("migrate needs a SQLite driver: run with Bun, or Node.js 22.12+ (node:sqlite)");
    })()
  );
}
