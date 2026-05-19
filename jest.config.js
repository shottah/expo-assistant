module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/plugin"],
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/__tests__/**/*.test.tsx",
    "**/__tests__/**/integration/*.test.ts",
  ],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          types: ["node", "jest"],
        },
      },
    ],
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "plugin/src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/index.ts",
    "!src/**/*.types.ts",
    "!src/__tests__/**",
    "!plugin/**/*.d.ts",
    "!plugin/**/index.ts",
    "!plugin/__tests__/**",
  ],
  coverageThreshold: {
    // Set near current baseline to catch regressions; Codecov tracks
    // absolute coverage and trends. Raise these as the dangerous Android
    // mods (write to disk) and the .web shim get real coverage in the
    // upcoming e2e and example-app work.
    global: {
      branches: 55,
      functions: 70,
      lines: 65,
      statements: 65,
    },
  },
  coverageReporters: ["text", "lcov", "html"],
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  moduleNameMapper: {
    "^expo$": "<rootDir>/src/__mocks__/expo.js",
    "^expo-modules-core$": "<rootDir>/src/__mocks__/expo-modules-core.js",
  },
};
