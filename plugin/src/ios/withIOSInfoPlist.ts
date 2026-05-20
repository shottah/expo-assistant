/**
 * Info.plist mod for expo-assistant.
 *
 * Sets the iOS usage descriptions (microphone, speech recognition,
 * Siri), alternative app names (`INAlternativeAppNames`), supported
 * user activity types (`NSUserActivityTypes`), background modes when
 * enabled, HealthKit usage descriptions when enabled, and SiriKit
 * domains when configured.
 *
 * Pure single-concern mod. The actual mutation lives in `setInfoPlist`
 * which is exported separately so it's directly testable without mod
 * plumbing.
 */

import {
  ConfigPlugin,
  ExportedConfigWithProps,
  withInfoPlist,
} from "@expo/config-plugins";

import {
  ExpoAssistantPluginConfig,
  INTENT_TYPE_MAPPINGS,
} from "../types";

export const withIOSInfoPlist: ConfigPlugin<ExpoAssistantPluginConfig> = (
  config,
  props
) => {
  return withInfoPlist(config, (cfg) => setInfoPlist(cfg, props));
};

export function setInfoPlist(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): ExportedConfigWithProps {
  const { ios = {} } = props;

  // Add usage descriptions
  config.modResults.NSMicrophoneUsageDescription =
    "This app needs microphone access for voice commands";

  config.modResults.NSSpeechRecognitionUsageDescription =
    "This app uses speech recognition for voice commands";

  config.modResults.NSSiriUsageDescription =
    ios.siriUsageDescription ||
    "This app uses Siri for voice assistant features";

  // Add alternative app names for better recognition
  if (ios.alternativeAppNames && ios.alternativeAppNames.length > 0) {
    config.modResults.CFBundleSpokenName =
      config.modResults.CFBundleDisplayName || config.modResults.CFBundleName;

    config.modResults.INAlternativeAppNames = ios.alternativeAppNames.map(
      (name) => ({
        INAlternativeAppName: name,
      })
    );
  }

  // Add supported user activity types
  const activityTypes: string[] = [];

  // Add default activity types
  activityTypes.push(`${config.ios?.bundleIdentifier || "com.yourapp"}.search`);
  activityTypes.push(
    `${config.ios?.bundleIdentifier || "com.yourapp"}.playMedia`
  );

  // Add intent-specific activity types
  if (props.intents) {
    props.intents.forEach((category) => {
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
    const backgroundModes =
      (config.modResults.UIBackgroundModes as string[]) || [];
    if (!backgroundModes.includes("audio")) {
      backgroundModes.push("audio");
    }
    if (!backgroundModes.includes("processing")) {
      backgroundModes.push("processing");
    }
    config.modResults.UIBackgroundModes = backgroundModes;
  }

  // Add HealthKit usage description if enabled
  if (props.enableHealthKit) {
    config.modResults.NSHealthShareUsageDescription =
      "This app uses HealthKit data for voice-controlled workouts";
    config.modResults.NSHealthUpdateUsageDescription =
      "This app updates HealthKit data based on your voice commands";
  }

  // Add media session keys if enabled
  if (props.enableMediaSession) {
    const modes = (config.modResults.UIBackgroundModes as string[]) || [];
    if (!modes.includes("audio")) {
      modes.push("audio");
    }
    config.modResults.UIBackgroundModes = modes;
  }

  // Add custom SiriKit domains if specified
  if (ios.siriKitDomains && ios.siriKitDomains.length > 0) {
    config.modResults.NSSiriKitDomains = ios.siriKitDomains;
  }

  if (props.debugMode) {
    console.log("[expo-assistant] iOS Info.plist configured");
  }

  return config;
}
