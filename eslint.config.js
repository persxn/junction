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
