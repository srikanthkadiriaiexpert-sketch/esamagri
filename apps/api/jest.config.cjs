/**
 * apps/api uses Jest, not Vitest (unlike the other TS workspaces in this
 * repo). NestJS's dependency injection relies on TypeScript's
 * `emitDecoratorMetadata` (reflect-metadata design:type/paramtypes),
 * which ts-jest supports natively; Vitest's default esbuild-based
 * transform does not emit that metadata, which breaks Nest's DI
 * container for anything with constructor-injected dependencies. Jest +
 * ts-jest is also NestJS's own documented default, so this keeps the
 * backend on its ecosystem's well-trodden path.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'src/.*\\.spec\\.ts$',
  moduleFileExtensions: ['js', 'json', 'ts'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  // Populates process.env with a complete, valid fixture BEFORE any
  // test file is loaded. This matters specifically because
  // ConfigModule.forRoot's `validate` (loadApiEnv) runs synchronously
  // at module-evaluation time, the moment app.module.ts is imported —
  // not deferred to Nest's bootstrap/compile() call — so process.env
  // must already be correct before that static import happens.
  setupFiles: ['<rootDir>/jest.setup.ts'],
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
};
