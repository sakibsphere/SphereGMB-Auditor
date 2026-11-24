const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'test-results/**', 'dist/**'] },
  js.configs.recommended,
  {
    files: ['content/**/*.js', 'popup/**/*.js', 'lib/**/*.js', 'pages/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.webextensions, module: 'readonly' }
    }
  },
  {
    files: ['background/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker, ...globals.webextensions }
    }
  },
  {
    files: ['test/**/*.js', 'tests/**/*.js', 'scripts/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  },
  {
    // Playwright page.evaluate() callbacks and the DOM test sandbox run browser code.
    files: ['tests/e2e/**/*.js', 'test/test-dom-integration.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser, ...globals.webextensions } }
  },
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['error', 'smart']
    }
  }
];
