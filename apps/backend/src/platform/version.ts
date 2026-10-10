/**
 * Version of this backend build. Mirrors `version` in apps/backend/package.json —
 * `version.test.ts` fails if the two drift. It is a constant rather than a
 * `package.json` import so the esbuild bundle (`dist-bundle/main.mjs`) carries it
 * without needing the manifest at runtime.
 */
export const APP_VERSION = '0.9.1';
