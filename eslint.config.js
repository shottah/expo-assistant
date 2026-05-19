const { defineConfig } = require('eslint/config');
const universeNative = require('eslint-config-universe/flat/native');
const universeWeb = require('eslint-config-universe/flat/web');

module.exports = defineConfig([
  ...universeNative,
  ...universeWeb,
  {
    ignores: ['build/**', 'plugin/build/**', 'node_modules/**', 'example/**', 'coverage/**', 'android/**', 'ios/**'],
  },
]);
