import js from '@eslint/js';
import tseslint from 'typescript-eslint';
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
    // findings that only ever showed up in an editor.
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
      'react-hooks': reactHooks,
    },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // TypeScript strictness
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // React hooks
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // General
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
    },
  },
  {
    // The suite is source too, and held to the same standard as what it checks:
    // a test is the only thing in the tree with nobody to check it back.
    files: ['test/**/*.ts'],
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      // `typeof import('…')` stays allowed here, unlike under src/. A suite that
      // reloads a module after `vi.resetModules()` imports it dynamically, and
      // that annotation is the only way to give the result its real type.
      '@typescript-eslint/consistent-type-imports': ['error', { disallowTypeAnnotations: false }],
      'prefer-const': 'error',
      // A stray `.only` is the one mistake a test suite cannot report itself:
      // it commits green, having quietly stopped running everything else in the
      // file. Written as a syntax restriction rather than pulled in with a
      // vitest plugin — one rule is not worth a dependency.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name=/^(describe|it|test)$/][property.name='only']",
          message: 'Remove `.only` — it silences every other test in the file.',
        },
      ],
    },
  },
  {
    ignores: ['dist/', 'out/', 'node_modules/', '*.js', '*.mjs'],
  },
);
