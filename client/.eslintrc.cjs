module.exports = {
  root: true,
  env: { browser: true, es2022: true },
  extends: ['plugin:vue/vue3-recommended', 'eslint:recommended', 'prettier'],
  parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
  rules: {
    'vue/multi-word-component-names': 'off',
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
};
