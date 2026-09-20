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
    coverage: {
      provider: 'v8',
      include: ['{apps,packages,tools}/*/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
    },
  },
});
