// Setup file for Jest tests.
// The native module is no longer auto-mocked globally — tests that want a
// mock call `jest.mock('../ExpoAssistantModule')` themselves so the real
// TS shim can be exercised by contract tests.
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn(),
};
