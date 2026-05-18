// Boundary mock for the `expo` package in a node jest environment.
// `requireNativeModule` returns a self-contained shape matching the
// `ExpoAssistantModule` TS contract so the real shim can load without
// circularly re-requiring itself.
module.exports = {
  NativeModule: class NativeModule {
    constructor() {}
    addListener() {
      return () => {};
    }
    removeListeners() {}
  },
  requireNativeModule: (_name) => ({
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
    addListener: jest.fn(() => ({ remove: () => {} })),
    removeListeners: jest.fn(),
  }),
};
