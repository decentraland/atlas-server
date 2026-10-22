/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/configuration
 */

const project = {
  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,
  // A preset that is used as a base for Jest's configuration
  preset: 'ts-jest',
}

module.exports = {
  // An array of glob patterns indicating a set of files for which coverage information should be collected
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  // The directory where Jest should output its coverage files
  coverageDirectory: 'coverage',
  // Indicates which provider should be used to instrument code for coverage
  coverageProvider: 'v8',
  // under the current suite with headroom, so unrelated changes don't trip it
  coverageThreshold: {
    global: { statements: 80, branches: 72, functions: 80, lines: 80 },
  },
  projects: [
    {
      ...project,
      displayName: 'unit',
      testMatch: ['<rootDir>/tests/**/?(*.)+(spec|test).[jt]s?(x)'],
      testPathIgnorePatterns: ['/node_modules/', '<rootDir>/tests/http/'],
    },
    {
      ...project,
      displayName: 'http',
      testMatch: ['<rootDir>/tests/http/**/?(*.)+(spec|test).[jt]s?(x)'],
      // stubs the external components before any test file loads src/
      setupFiles: ['<rootDir>/tests/harness/mocks.ts'],
    },
  ],
}
