module.exports = {
  root: true,
  env: { node: true, es2022: true, jest: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  parser: '@typescript-eslint/parser',
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', project: null },
  ignorePatterns: ['dist', '.eslintrc.cjs', 'jest.config.cjs'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    // Nest modules with no providers/controllers yet (STEP 5+ fills
    // them in) are legitimately empty classes decorated with @Module({}).
    '@typescript-eslint/no-extraneous-class': 'off',
  },
};
