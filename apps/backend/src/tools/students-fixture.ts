import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { import500Csv } from '../testing/students-demo.js';

/**
 * `pnpm --filter @compintel/backend students:fixture` — writes
 * `test/fixtures/students/import-500.csv` from the generator in
 * `testing/students-demo.ts` (WP-17 step 7). A test fails when the committed
 * file and the generator drift apart, so regenerating is a deliberate act.
 */
const target = path.resolve(
  import.meta.dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'students',
  'import-500.csv',
);
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, import500Csv(), 'utf8');
console.log(`wrote ${target}`);
