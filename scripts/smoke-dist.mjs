// Consumer-grade check of the published build in dist/.
// Run after `bun run build`: node scripts/smoke-dist.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, "..");

const schema = {
  users: {
    columns: [{ c_name: "id", c_type: "text", is_primary_key: true }],
  },
};

// 1. ESM import under plain Node.
const esm = await import("../dist/mod.mjs");
const esmSql = esm.generateSQLite(schema);
if (!esmSql.includes('CREATE TABLE "users"')) throw new Error("ESM build broken");

// 2. CJS require under plain Node.
const cjs = require("../dist/mod.cjs");
const cjsSql = cjs.generateSQLite(schema);
if (cjsSql !== esmSql) throw new Error("CJS build diverges from ESM");

// 3. Must bundle for browsers (fails if the lib ever imports node builtins).
const dir = mkdtempSync(join(tmpdir(), "easyqlite-"));
try {
  execFileSync(
    process.execPath,
    [
      join(root, "node_modules", "esbuild", "bin", "esbuild"),
      join(root, "dist", "mod.mjs"),
      "--bundle",
      "--platform=browser",
      "--format=esm",
      `--outfile=${join(dir, "browser.mjs")}`,
    ],
    { stdio: "pipe" },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// 4. The compiled CLI runs on plain Node.
const cli = join(root, "dist", "cli.cjs");
const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
if (!help.includes("easyql")) throw new Error("CLI bundle broken");

console.log("dist smoke OK: esm + cjs + browser bundle + cli");
