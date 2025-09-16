module.exports = {
  NativeModulesProxy: {},
  EventEmitter: class EventEmitter {
    addListener() {
      return { remove: () => {} };
    }
    removeAllListeners() {}
    emit() {}
  }
};