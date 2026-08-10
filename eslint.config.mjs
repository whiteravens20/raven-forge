import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // A leading underscore means "named so it can be discarded" everywhere, not
    // only under src/: the rest-destructuring omit idiom in the tests has to name
    // the keys it is dropping.
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Build and maintenance scripts are source and get linted, but they run in
    // Node rather than in the app, so `console`, `Buffer` and `__dirname` are
    // defined for them. Without this they report as undefined identifiers — 55
    // findings that only ever showed up in an editor, since the gate is
    // `eslint src/`.
    files: ['scripts/**', '.github/scripts/**'],
    languageOptions: { globals: globals.node },
  },
  {
    // `npm run icons` is executed by Electron, which silently never runs a `.mjs`
    // entry point, so that script is CommonJS by necessity and `require` in it is
    // the correct form rather than a lapse.
    files: ['**/*.cjs'],
    languageOptions: { globals: globals.node, sourceType: 'commonjs' },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      // TypeScript strictness
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // React hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // React
      'react/react-in-jsx-scope': 'off',

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
    },
  },
  {
    ignores: ['dist/', 'out/', 'node_modules/', '*.js', '*.mjs'],
  },
);
