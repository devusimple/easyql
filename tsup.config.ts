import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { mod: "src/mod.ts" },
    format: ["esm", "cjs"],
    dts: true,
    target: "es2020",
    clean: true,
    outExtension({ format }) {
      return { js: format === "esm" ? ".mjs" : ".cjs" };
    },
  },
  {
    entry: { cli: "src/index.ts" },
    format: ["cjs"],
    target: "node16",
    banner: { js: "#!/usr/bin/env node" },
  },
]);
