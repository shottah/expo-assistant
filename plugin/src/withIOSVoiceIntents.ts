/**
 * iOS config plugin for expo-assistant
 * Handles Info.plist, entitlements, and Intent Extension setup
 */

import {
  ConfigPlugin,
  withInfoPlist,
  withEntitlementsPlist,
  withXcodeProject,
  ExportedConfigWithProps
} from '@expo/config-plugins';
import { ExpoAssistantPluginConfig, INTENT_TYPE_MAPPINGS } from './types';
import path from 'path';
import fs from 'fs';

export const withIOSVoiceIntents: ConfigPlugin<ExpoAssistantPluginConfig> = (config, props) => {
  config = withInfoPlist(config, (config) => {
    return setInfoPlist(config, props);
  });

  config = withEntitlementsPlist(config, (config) => {
    return setEntitlements(config, props);
  });

  if (props.ios?.intentExtensionBundleId || props.intents?.includes('custom' as any)) {
    config = withXcodeProject(config, (config) => {
      return createIntentExtension(config, props);
    });
  }

  return config;
};

function setInfoPlist(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): ExportedConfigWithProps {
  const { ios = {} } = props;

  // Add usage descriptions
  config.modResults.NSMicrophoneUsageDescription =
    'This app needs microphone access for voice commands';

  config.modResults.NSSpeechRecognitionUsageDescription =
    'This app uses speech recognition for voice commands';

  config.modResults.NSSiriUsageDescription =
    ios.siriUsageDescription || 'This app uses Siri for voice assistant features';

  // Add alternative app names for better recognition
  if (ios.alternativeAppNames && ios.alternativeAppNames.length > 0) {
    config.modResults.CFBundleSpokenName = config.modResults.CFBundleDisplayName || config.modResults.CFBundleName;

    config.modResults.INAlternativeAppNames = ios.alternativeAppNames.map(name => ({
      INAlternativeAppName: name
    }));
  }

  // Add supported user activity types
  const activityTypes: string[] = [];

  // Add default activity types
  activityTypes.push(`${config.ios?.bundleIdentifier || 'com.yourapp'}.search`);
  activityTypes.push(`${config.ios?.bundleIdentifier || 'com.yourapp'}.playMedia`);

  // Add intent-specific activity types
  if (props.intents) {
    props.intents.forEach(category => {
      const intentTypes = INTENT_TYPE_MAPPINGS.ios[category];
      if (intentTypes) {
        activityTypes.push(...intentTypes);
      }
    });
  }

  // Add custom intent types if specified
  if (ios.supportedIntentTypes) {
    activityTypes.push(...ios.supportedIntentTypes);
  }

  config.modResults.NSUserActivityTypes = [...new Set(activityTypes)];

  // Add background modes if enabled
  if (props.enableBackgroundExecution) {
    const backgroundModes = (config.modResults.UIBackgroundModes as string[]) || [];
    if (!backgroundModes.includes('audio')) {
      backgroundModes.push('audio');
    }
    if (!backgroundModes.includes('processing')) {
      backgroundModes.push('processing');
    }
    config.modResults.UIBackgroundModes = backgroundModes;
  }

  // Add HealthKit usage description if enabled
  if (props.enableHealthKit) {
    config.modResults.NSHealthShareUsageDescription =
      'This app uses HealthKit data for voice-controlled workouts';
    config.modResults.NSHealthUpdateUsageDescription =
      'This app updates HealthKit data based on your voice commands';
  }

  // Add media session keys if enabled
  if (props.enableMediaSession) {
    const modes = (config.modResults.UIBackgroundModes as string[]) || [];
    if (!modes.includes('audio')) {
      modes.push('audio');
    }
    config.modResults.UIBackgroundModes = modes;
  }

  // Add custom SiriKit domains if specified
  if (ios.siriKitDomains && ios.siriKitDomains.length > 0) {
    config.modResults.NSSiriKitDomains = ios.siriKitDomains;
  }

  if (props.debugMode) {
    console.log('[expo-assistant] iOS Info.plist configured');
  }

  return config;
}

function setEntitlements(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): ExportedConfigWithProps {
  const { ios = {} } = props;

  // Add SiriKit entitlement
  if (props.enableSiriKit !== false) {
    config.modResults['com.apple.developer.siri'] = true;
  }

  // Add App Groups for data sharing with extensions
  if (ios.appGroups && ios.appGroups.length > 0) {
    config.modResults['com.apple.security.application-groups'] = ios.appGroups;
  } else if (ios.intentExtensionBundleId) {
    // Create default app group if intent extension is enabled
    const bundleId = config.ios?.bundleIdentifier || 'com.yourapp';
    config.modResults['com.apple.security.application-groups'] = [
      `group.${bundleId}.voiceassistant`
    ];
  }

  // Add HealthKit entitlement if enabled
  if (props.enableHealthKit) {
    config.modResults['com.apple.developer.healthkit'] = true;
    config.modResults['com.apple.developer.healthkit.background-delivery'] = true;
  }

  // Add Media Session entitlement if enabled
  if (props.enableMediaSession) {
    config.modResults['com.apple.developer.playable-content'] = true;
  }

  if (props.debugMode) {
    console.log('[expo-assistant] iOS entitlements configured');
  }

  return config;
}

function createIntentExtension(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): ExportedConfigWithProps {
  const { ios = {} } = props;
  const projectRoot = config.modRequest.projectRoot;
  const bundleId = config.ios?.bundleIdentifier || 'com.yourapp';
  const extensionBundleId = ios.intentExtensionBundleId || `${bundleId}.IntentExtension`;
  const extensionName = 'IntentExtension';

  // Get Xcode project
  // Note: These are used for Xcode project manipulation in full implementation
  // const project = config.modResults;
  // const projectName = config.modRequest.projectName || 'MyApp';

  // Create Intent Extension directory
  const extensionPath = path.join(projectRoot, 'ios', extensionName);
  if (!fs.existsSync(extensionPath)) {
    fs.mkdirSync(extensionPath, { recursive: true });
  }

  // Create Info.plist for Intent Extension
  const extensionInfoPlist = {
    CFBundleDevelopmentRegion: '$(DEVELOPMENT_LANGUAGE)',
    CFBundleDisplayName: extensionName,
    CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: extensionBundleId,
    CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: '$(PRODUCT_NAME)',
    CFBundlePackageType: '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    CFBundleShortVersionString: '$(MARKETING_VERSION)',
    CFBundleVersion: '$(CURRENT_PROJECT_VERSION)',
    NSExtension: {
      NSExtensionPointIdentifier: 'com.apple.intents-service',
      NSExtensionPrincipalClass: `$(PRODUCT_MODULE_NAME).IntentHandler`,
      IntentsSupported: getIntentsSupported(props),
      IntentsRestrictedWhileLocked: getRestrictedIntents(props)
    }
  };

  fs.writeFileSync(
    path.join(extensionPath, 'Info.plist'),
    require('plist').build(extensionInfoPlist)
  );

  // Create IntentHandler.swift
  const intentHandlerSwift = `import Intents

class IntentHandler: INExtension {

    override func handler(for intent: INIntent) -> Any {
        // Handle different intent types
        switch intent {
        case is INSearchIntent:
            return SearchIntentHandler()
        case is INPlayMediaIntent:
            return PlayMediaIntentHandler()
        ${props.intents?.includes('productivity' as any) ? `
        case is INCreateTaskIntent:
            return CreateTaskIntentHandler()` : ''}
        ${props.intents?.includes('health' as any) ? `
        case is INStartWorkoutIntent:
            return StartWorkoutIntentHandler()` : ''}
        default:
            return self
        }
    }
}

// Base handlers for each intent type
class SearchIntentHandler: NSObject, INSearchIntentHandling {
    func handle(intent: INSearchIntent, completion: @escaping (INSearchIntentResponse) -> Void) {
        let response = INSearchIntentResponse(code: .success, userActivity: nil)
        completion(response)
    }
}

class PlayMediaIntentHandler: NSObject, INPlayMediaIntentHandling {
    func handle(intent: INPlayMediaIntent, completion: @escaping (INPlayMediaIntentResponse) -> Void) {
        let response = INPlayMediaIntentResponse(code: .success, userActivity: nil)
        completion(response)
    }
}
${props.intents?.includes('productivity' as any) ? `
class CreateTaskIntentHandler: NSObject, INCreateTaskIntentHandling {
    func handle(intent: INCreateTaskIntent, completion: @escaping (INCreateTaskIntentResponse) -> Void) {
        let response = INCreateTaskIntentResponse(code: .success, userActivity: nil)
        completion(response)
    }
}` : ''}
${props.intents?.includes('health' as any) ? `
class StartWorkoutIntentHandler: NSObject, INStartWorkoutIntentHandling {
    func handle(intent: INStartWorkoutIntent, completion: @escaping (INStartWorkoutIntentResponse) -> Void) {
        let response = INStartWorkoutIntentResponse(code: .success, userActivity: nil)
        completion(response)
    }
}` : ''}
`;

  fs.writeFileSync(
    path.join(extensionPath, 'IntentHandler.swift'),
    intentHandlerSwift
  );

  // Add Intent Extension to Xcode project
  // Note: This is a simplified version. In production, you'd use pbxproj manipulation
  // libraries like xcode or react-native-community/cli-platform-ios

  if (props.debugMode) {
    console.log(`[expo-assistant] Intent Extension created at ${extensionPath}`);
    console.log('[expo-assistant] Note: You may need to manually add the extension to your Xcode project');
  }

  return config;
}

function getIntentsSupported(props: ExpoAssistantPluginConfig): string[] {
  const intents: string[] = [];

  if (props.intents) {
    props.intents.forEach(category => {
      const mappedIntents = INTENT_TYPE_MAPPINGS.ios[category];
      if (mappedIntents) {
        intents.push(...mappedIntents);
      }
    });
  }

  // Add custom intents if specified
  if (props.ios?.supportedIntentTypes) {
    intents.push(...props.ios.supportedIntentTypes);
  }

  return [...new Set(intents)];
}

function getRestrictedIntents(props: ExpoAssistantPluginConfig): string[] {
  // Intents that should require device unlock
  const restricted: string[] = [];

  if (props.ios?.requiresUnlock !== false) {
    // Add sensitive intents that should require unlock
    restricted.push('INSendPaymentIntent');
    restricted.push('INRequestPaymentIntent');
    restricted.push('INTransferMoneyIntent');
  }

  return restricted;
}