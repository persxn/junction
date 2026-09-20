import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Test against the sources, so `pnpm test` does not depend on `tsc -b` output.
      '@compintel/contracts': fileURLToPath(
        new URL('./packages/contracts/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    // One root run covering every workspace package.
    include: ['{apps,packages,tools}/*/src/**/*.test.ts'],
    environment: 'node',
    clearMocks: true,
    // The backend process tests spawn a real Node child and wait for its READY
    // line; 5 s is too tight for a cold tsx start on this machine.
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['{apps,packages,tools}/*/src/**/*.ts'],
      exclude: ['**/*.test.ts', '**/src/testing/**', '**/src/tools/**'],
    },
  },
});
