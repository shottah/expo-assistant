module.exports = {
  NativeModule: class NativeModule {
    constructor() {}
    addListener() {
      return () => {};
    }
    removeListeners() {}
  },
  requireNativeModule: (name) => {
    return require('../ExpoAssistantModule');
  }
};