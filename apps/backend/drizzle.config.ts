import { defineConfig } from 'drizzle-kit';

/**
 * Generation only. `drizzle-kit push` is never used (§4.6): the generated SQL is
 * committed and reviewed, and FTS5 tables and triggers arrive as `--custom`
 * migrations that drizzle-kit cannot infer from the schema.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema/index.ts',
  out: './migrations',
  strict: true,
  verbose: true,
});
