import globals from 'globals';

export default [
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        XMT: 'writable'
      }
    },
    linterOptions: {
      reportUnusedDisableDirectives: true
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-implied-eval': 'error',
      'no-eval': 'error',
      eqeqeq: ['error', 'smart'],
      'no-console': 'off',
      curly: ['error', 'multi-line'],
      'no-throw-literal': 'error',
      'prefer-template': 'warn'
    }
  },
  {
    // Service worker berjalan di lingkup worker, bukan window.
    files: ['src/background/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
        ...globals.webextensions
      }
    }
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node }
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error'
    }
  }
];
