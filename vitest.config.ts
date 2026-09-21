import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const contractsSource = fileURLToPath(
  new URL('./packages/contracts/src/index.ts', import.meta.url),
);

// Test against the contracts sources, so `pnpm test` does not depend on `tsc -b`
// output. Both projects need it, so it is declared once.
const resolve = { alias: { '@compintel/contracts': contractsSource } };

export default defineConfig({
  resolve,
  test: {
    // One root `pnpm test` still runs everything; the split below only decides
    // which global environment each file gets (WP-06).
    projects: [
      {
        resolve,
        test: {
          name: 'node',
          // The backend, the contracts and the tools are Node code: giving them a
          // DOM would let a test pass on something that cannot exist in the
          // backend process.
          environment: 'node',
          include: ['{apps,packages,tools}/*/src/**/*.test.ts', 'tools/perf/*/src/**/*.test.ts'],
          exclude: ['apps/desktop/**'],
          clearMocks: true,
          // The backend process tests spawn a real Node child and wait for its
          // READY line; 5 s is too tight for a cold tsx start on this machine.
          testTimeout: 20_000,
          hookTimeout: 20_000,
        },
      },
      {
        resolve,
        test: {
          name: 'desktop',
          environment: 'jsdom',
          include: ['apps/desktop/src/**/*.test.{ts,tsx}'],
          setupFiles: ['./apps/desktop/src/testing/setup.ts'],
          clearMocks: true,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['{apps,packages,tools}/*/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/src/testing/**', '**/src/tools/**'],
    },
  },
});
