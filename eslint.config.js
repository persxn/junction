// Flat config. Type-checked rules apply to TypeScript only; plain .js config files
// (this file included) get the base JS rules.
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-bundle/**',
      '**/coverage/**',
      '**/target/**',
      '**/dist-types/**',
      '**/*.tsbuildinfo',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.ts', '**/*.tsx'],
    extends: [...tseslint.configs.recommendedTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        // These config files live outside every composite project.
        projectService: {
          allowDefaultProject: [
            'vitest.config.ts',
            'apps/backend/drizzle.config.ts',
            'apps/desktop/vite.config.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      // A leading underscore marks "deliberately unused", matching tsconfig's
      // noUnusedLocals / noUnusedParameters behaviour.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },

  // §3.3's layering, enforced rather than agreed. `no-restricted-imports` is a
  // core rule, so this needs no plugin: it matches the import specifier, which is
  // exactly what each of these three rules is about.
  //
  // Only *direct* imports are checked. A service that a domain file imports may
  // itself reach the database, and nothing here notices — but a rule that is
  // mechanical and shallow still catches the mistake people actually make, which
  // is reaching for `drizzle-orm` because the query was easier to write inline.
  {
    // WP-15a: a module's own `domain/` folder (modules/search/domain) is held to
    // the same rule as src/domain.
    files: ['apps/backend/src/domain/**/*.ts', 'apps/backend/src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'drizzle-orm',
                'drizzle-orm/*',
                'better-sqlite3',
                'fastify',
                '@fastify/*',
                'pino',
                'node:fs',
                'node:fs/*',
                'node:path',
              ],
              message:
                'src/domain is pure logic: no I/O and no framework (§3.3). Take the data as an argument and let a service or repository fetch it.',
            },
            {
              group: ['**/db/**', '../db/*', '../../db/*'],
              message:
                'src/domain may not know how anything is stored (§3.3). Describe the shape it needs in the domain file; a Drizzle row satisfies it structurally.',
            },
          ],
        },
      ],
    },
  },

  // §3.3 again, one layer up: a route parses, authenticates and maps errors. It
  // does not query. Going through a service is what keeps authorization and the
  // audit entry in one place instead of per-route.
  {
    files: ['apps/backend/src/routes/**/*.ts'],
    ignores: ['apps/backend/src/routes/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/db/**', '../db/*'],
              message:
                'A route goes through a service, never straight to the database (§3.3), so authorization and the audit entry cannot be skipped.',
            },
          ],
        },
      ],
    },
  },

  // Contracts is the shared vocabulary both sides compile against. If it could
  // import an app, the app could not import it.
  {
    files: ['packages/contracts/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/apps/**', '@compintel/backend', '@compintel/desktop'],
              message:
                'packages/contracts is imported by every app and must not depend on one (§3.4).',
            },
          ],
        },
      ],
    },
  },

  // CLAUDE.md's "files < 400 lines" has been checked by hand in every WP since
  // WP-04a. It is the linter's job now. Tests are exempt: a long table of cases
  // is a good test, and splitting one to satisfy a counter helps nobody.
  {
    files: ['apps/*/src/**/*.{ts,tsx}', 'packages/*/src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}', '**/src/testing/**'],
    rules: {
      'max-lines': ['error', { max: 400, skipBlankLines: false, skipComments: false }],
    },
  },

  // Ruling R6: the React plugins are scoped to the one package that has React in
  // it, so a stray hook call in the backend is a missing import, not a lint rule.
  // `configs.flat` is the plugin's flat-config export; its top-level
  // `recommended-latest` is still eslintrc-shaped (plugins as an array).
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },

  // Must stay last: turns off every rule Prettier owns.
  prettier,
);
