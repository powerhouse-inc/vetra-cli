/** @type {import('jest').Config} */
export default {
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/tests/**/*.test.ts'],
  // Sample reactor projects under <rootDir> (e.g. `workout-tracker/`) ship
  // their own scaffolded test suites; those run from inside the project, not
  // as part of vetra-cli's suite. Skip them, plus the `.ph/` cache.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/workout-tracker/', '<rootDir>/\\.ph/'],
  modulePathIgnorePatterns: ['<rootDir>/\\.ph/'],
  watchPathIgnorePatterns: ['<rootDir>/\\.ph/'],
};
