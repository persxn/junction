import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

/** Where the packaged shell expects the backend (ARCHITECTURE.md 3.2, A20). */
const OUT_FILE = fileURLToPath(new URL('../../dist-bundle/main.mjs', import.meta.url));

/**
 * esbuild emits ESM, but Fastify and pino still reach for `require` internally;
 * re-creating it from `import.meta.url` is the standard bridge.
 */
const REQUIRE_SHIM =
  "import{createRequire as __compintelCreateRequire}from'node:module';" +
  'const require=__compintelCreateRequire(import.meta.url);';

const result = await build({
  entryPoints: [fileURLToPath(new URL('../main.ts', import.meta.url))],
  outfile: OUT_FILE,
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: REQUIRE_SHIM },
  sourcemap: true,
  logLevel: 'info',
  metafile: false,
});

if (result.errors.length > 0) {
  throw new Error(`esbuild reported ${result.errors.length.toString()} error(s).`);
}
