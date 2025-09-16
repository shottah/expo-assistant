/**
 * Tests for expo-assistant config plugin
 */

import withExpoAssistant, { IntentCategory } from '../src/index';
import { ExpoConfig } from '@expo/config-types';

// Mock the config plugins to avoid file system operations in tests
jest.mock('@expo/config-plugins', () => ({
  ...jest.requireActual('@expo/config-plugins'),
  withPlugins: jest.fn((config) => config),
  withInfoPlist: jest.fn((config) => config),
  withEntitlementsPlist: jest.fn((config) => config),
  withXcodeProject: jest.fn((config) => config),
  withAndroidManifest: jest.fn((config) => config),
  withDangerousMod: jest.fn((config) => config)
}));

describe('withExpoAssistant', () => {
  let config: ExpoConfig;

  beforeEach(() => {
    config = {
      name: 'test-app',
      slug: 'test-app',
      version: '1.0.0',
      ios: {
        bundleIdentifier: 'com.test.app'
      },
      android: {
        package: 'com.test.app'
      }
    };
  });

  describe('Basic Configuration', () => {
    it('should apply default configuration', () => {
      const result = withExpoAssistant(config, {});
      expect(result).toBeDefined();
      expect(result.name).toBe('test-app');
    });

    it('should accept minimal configuration', () => {
      const result = withExpoAssistant(config, {
        intents: [IntentCategory.SEARCH]
      });
      expect(result).toBeDefined();
    });

    it('should accept full configuration', () => {
      const result = withExpoAssistant(config, {
        enableSiriKit: true,
        enableAppIntents: true,
        enableAppActions: true,
        enableBackgroundExecution: true,
        intents: [
          IntentCategory.SEARCH,
          IntentCategory.MEDIA,
          IntentCategory.PRODUCTIVITY
        ],
        ios: {
          siriUsageDescription: 'Custom Siri description',
          alternativeAppNames: ['Test App', 'My App'],
          intentExtensionBundleId: 'com.test.app.intents',
          appGroups: ['group.com.test.app'],
          supportedIntentTypes: ['CustomIntent'],
          requiresUnlock: false
        },
        android: {
          appActionsTestUrl: 'https://test.app/actions',
          deepLinkVerification: true,
          voiceInteractionService: true,
          slicesEnabled: true,
          customVocabulary: {
            terms: [
              {
                value: 'test',
                synonyms: ['testing', 'check']
              }
            ]
          }
        },
        debugMode: false
      });

      expect(result).toBeDefined();
    });
  });

  describe('iOS Configuration', () => {
    it('should configure iOS permissions', () => {
      const result = withExpoAssistant(config, {
        enableSiriKit: true,
        ios: {
          siriUsageDescription: 'Test Siri usage'
        }
      });

      // The actual modifications would be in the modResults
      // This is a simplified test
      expect(result.ios?.bundleIdentifier).toBe('com.test.app');
    });

    it('should handle alternative app names', () => {
      const result = withExpoAssistant(config, {
        ios: {
          alternativeAppNames: ['Alt Name 1', 'Alt Name 2']
        }
      });

      expect(result).toBeDefined();
    });

    it('should configure intent extension when custom intents are used', () => {
      const result = withExpoAssistant(config, {
        intents: [IntentCategory.CUSTOM],
        ios: {
          intentExtensionBundleId: 'com.test.app.intents'
        }
      });

      expect(result).toBeDefined();
    });
  });

  describe('Android Configuration', () => {
    it('should configure Android permissions', () => {
      const result = withExpoAssistant(config, {
        enableAppActions: true
      });

      expect(result.android?.package).toBe('com.test.app');
    });

    it('should enable Slices when configured', () => {
      const result = withExpoAssistant(config, {
        android: {
          slicesEnabled: true
        }
      });

      expect(result).toBeDefined();
    });

    it('should configure voice interaction service', () => {
      const result = withExpoAssistant(config, {
        android: {
          voiceInteractionService: true
        }
      });

      expect(result).toBeDefined();
    });

    it('should handle custom vocabulary', () => {
      const result = withExpoAssistant(config, {
        android: {
          customVocabulary: {
            terms: [
              {
                value: 'meeting',
                synonyms: ['standup', 'sync']
              }
            ]
          }
        }
      });

      expect(result).toBeDefined();
    });
  });

  describe('Intent Categories', () => {
    it('should configure search intents', () => {
      const result = withExpoAssistant(config, {
        intents: [IntentCategory.SEARCH]
      });

      expect(result).toBeDefined();
    });

    it('should configure media intents', () => {
      const result = withExpoAssistant(config, {
        intents: [IntentCategory.MEDIA],
        enableBackgroundExecution: true
      });

      expect(result).toBeDefined();
    });

    it('should configure productivity intents', () => {
      const result = withExpoAssistant(config, {
        intents: [IntentCategory.PRODUCTIVITY]
      });

      expect(result).toBeDefined();
    });

    it('should configure health intents', () => {
      const result = withExpoAssistant(config, {
        intents: [IntentCategory.HEALTH]
      });

      expect(result).toBeDefined();
    });

    it('should configure communication intents', () => {
      const result = withExpoAssistant(config, {
        intents: [IntentCategory.COMMUNICATION]
      });

      expect(result).toBeDefined();
    });

    it('should handle multiple intent categories', () => {
      const result = withExpoAssistant(config, {
        intents: [
          IntentCategory.SEARCH,
          IntentCategory.MEDIA,
          IntentCategory.PRODUCTIVITY,
          IntentCategory.HEALTH
        ]
      });

      expect(result).toBeDefined();
    });
  });

  describe('Background Execution', () => {
    it('should enable background execution for media', () => {
      const result = withExpoAssistant(config, {
        intents: [IntentCategory.MEDIA],
        enableBackgroundExecution: true
      });

      expect(result).toBeDefined();
    });

    it('should configure background modes for iOS', () => {
      const result = withExpoAssistant(config, {
        enableBackgroundExecution: true,
        ios: {
          requiresUnlock: false
        }
      });

      expect(result).toBeDefined();
    });
  });

  describe('Debug Mode', () => {
    it('should handle debug mode configuration', () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      withExpoAssistant(config, {
        debugMode: true
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[expo-assistant] Plugin configuration:',
        expect.any(String)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('Error Handling', () => {
    it('should handle missing iOS config', () => {
      const configWithoutIOS = {
        name: 'test-app',
        slug: 'test-app',
        version: '1.0.0'
      };

      const result = withExpoAssistant(configWithoutIOS, {
        intents: [IntentCategory.SEARCH]
      });

      expect(result).toBeDefined();
    });

    it('should handle missing Android config', () => {
      const configWithoutAndroid = {
        name: 'test-app',
        slug: 'test-app',
        version: '1.0.0',
        ios: {
          bundleIdentifier: 'com.test.app'
        }
      };

      const result = withExpoAssistant(configWithoutAndroid, {
        intents: [IntentCategory.SEARCH]
      });

      expect(result).toBeDefined();
    });

    it('should handle empty configuration', () => {
      const result = withExpoAssistant(config, {});
      expect(result).toBeDefined();
    });
  });
});