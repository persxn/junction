import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

/** Where the packaged shell expects the backend (ARCHITECTURE.md 3.2, A20). */
const OUT_DIR = fileURLToPath(new URL('../../dist-bundle/', import.meta.url));
const MIGRATIONS_SRC = fileURLToPath(new URL('../../migrations/', import.meta.url));

/**
 * esbuild emits ESM, but Fastify, pino and better-sqlite3 are CommonJS inside and
 * reach for `require`, `__dirname` and `__filename`. Re-creating all three from
 * `import.meta.url` is the standard bridge; without `__dirname` the bundle only
 * fails on the code paths that look for a prebuild, which is exactly the path
 * ruling R17 replaces with an explicit `nativeBinding`.
 */
const CJS_SHIM = [
  "import{createRequire as __compintelCreateRequire}from'node:module';",
  "import{fileURLToPath as __compintelFileURLToPath}from'node:url';",
  "import{dirname as __compintelDirname}from'node:path';",
  'const require=__compintelCreateRequire(import.meta.url);',
  'const __filename=__compintelFileURLToPath(import.meta.url);',
  'const __dirname=__compintelDirname(__filename);',
].join('');

/** The prebuilt addon for this platform, copied next to the bundle (R17). */
function nativeBindingSource(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('better-sqlite3/package.json');
  return path.join(
    path.dirname(packageJson),
    'prebuilds',
    `${process.platform}-${process.arch}.node`,
  );
}

rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(path.join(OUT_DIR, 'native'), { recursive: true });

const result = await build({
  entryPoints: [fileURLToPath(new URL('../main.ts', import.meta.url))],
  outfile: path.join(OUT_DIR, 'main.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  banner: { js: CJS_SHIM },
  sourcemap: true,
  logLevel: 'info',
  metafile: false,
});

if (result.errors.length > 0) {
  throw new Error(`esbuild reported ${result.errors.length.toString()} error(s).`);
}

cpSync(nativeBindingSource(), path.join(OUT_DIR, 'native', 'better_sqlite3.node'));
cpSync(MIGRATIONS_SRC, path.join(OUT_DIR, 'migrations'), { recursive: true });

process.stdout.write(
  `  copied native\\better_sqlite3.node and migrations\\ into ${path.relative(process.cwd(), OUT_DIR)}\n`,
);
