import { createRequire } from "node:module";

// tsx already pins the esbuild used by this repository's migration tooling.
const requireTsx = createRequire(createRequire(import.meta.url).resolve("tsx"));
requireTsx("esbuild").buildSync({
  entryPoints: ["scripts/migrate.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  define: { "import.meta.url": "__migrationMetaUrl" },
  banner: {
    js: 'const __migrationMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
  outfile: ".next/migration/migrate.cjs",
});
