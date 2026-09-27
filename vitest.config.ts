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
    /**
     * Ruling R89, measured: this box has 8 cores and 16 threads, and vitest's
     * default (one worker per thread) oversubscribes it badly. Two of the suites
     * hash with Argon2id at 128 MiB and three spawn real backend processes, so at
     * sixteen workers a cold `node --import tsx` start could be starved for more
     * than twenty seconds — a timeout that says nothing about the code. Twelve is
     * where the whole run stopped getting faster: 118 s at the default, 96 s here.
     */
    maxWorkers: 8,
    // Three projects. `node` and `desktop` are the split WP-06 made — which
    // global environment a file gets — and are what `pnpm verify` runs. `a11y`
    // is ruling R89's: the multi-pass axe suites over whole screens are the
    // slowest thing in the suite and they proved nothing the rest of it does, so
    // they live in `*.a11y.test.tsx` and run as `pnpm test:a11y`, which every WP
    // touching `apps/desktop` runs and reports like R19's Rust checks.
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
          exclude: ['apps/desktop/src/**/*.a11y.test.{ts,tsx}'],
          setupFiles: ['./apps/desktop/src/testing/setup.ts'],
          clearMocks: true,
        },
      },
      {
        resolve,
        test: {
          name: 'a11y',
          environment: 'jsdom',
          include: ['apps/desktop/src/**/*.a11y.test.{ts,tsx}'],
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
