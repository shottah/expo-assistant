// Setup file for Jest tests
global.console = {
  ...console,
  error: jest.fn(),
  warn: jest.fn()
};

// Mock native module
jest.mock('./src/ExpoAssistantModule', () => ({
  initialize: jest.fn(),
  registerIntent: jest.fn(),
  unregisterIntent: jest.fn(),
  donateIntent: jest.fn(),
  requestMicrophonePermission: jest.fn(),
  requestSpeechRecognitionPermission: jest.fn(),
  checkCapabilities: jest.fn(),
  enableSiriKit: jest.fn(),
  enableAppActions: jest.fn(),
  enableBackgroundProcessing: jest.fn(),
  enableCustomUI: jest.fn(),
  getPlatform: jest.fn(),
  getLocale: jest.fn(),
  setDebugMode: jest.fn(),
  addListener: jest.fn((eventName, listener) => ({ remove: () => {} })),
  removeListeners: jest.fn()
}));