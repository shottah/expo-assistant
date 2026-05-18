/**
 * Exercises the real `ExpoAssistantModule.ts` shim (no jest.mock here) to
 * pin the TS contract the rest of the codebase relies on. If a method gets
 * renamed in the shim without the Swift/Kotlin side following, this test
 * catches the drift at PR time instead of on-device.
 */

import ExpoAssistantModule from '../ExpoAssistantModule';

describe('ExpoAssistantModule contract', () => {
  const expectedMethods = [
    'initialize',
    'registerIntent',
    'unregisterIntent',
    'donateIntent',
    'requestMicrophonePermission',
    'requestSpeechRecognitionPermission',
    'checkCapabilities',
    'enableSiriKit',
    'enableAppActions',
    'enableBackgroundProcessing',
    'enableCustomUI',
    'getPlatform',
    'getLocale',
    'setDebugMode',
  ] as const;

  it.each(expectedMethods)('exposes %s as a function', (method) => {
    expect(typeof (ExpoAssistantModule as Record<string, unknown>)[method]).toBe(
      'function'
    );
  });

  it('exposes the event emitter surface', () => {
    expect(typeof (ExpoAssistantModule as Record<string, unknown>).addListener).toBe(
      'function'
    );
    expect(typeof (ExpoAssistantModule as Record<string, unknown>).removeListeners).toBe(
      'function'
    );
  });
});
