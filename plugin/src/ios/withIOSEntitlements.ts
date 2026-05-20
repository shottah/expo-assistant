/**
 * Entitlements mod for expo-assistant.
 *
 * Adds the SiriKit entitlement (unless explicitly disabled), App Groups
 * for data sharing with extensions, HealthKit entitlements when
 * enabled, and the media-session playable-content entitlement when
 * enabled.
 *
 * Pure single-concern mod. `setEntitlements` is exported separately
 * for direct unit testing without mod plumbing.
 */

import {
  ConfigPlugin,
  ExportedConfigWithProps,
  withEntitlementsPlist,
} from "@expo/config-plugins";

import { ExpoAssistantPluginConfig } from "../types";

export const withIOSEntitlements: ConfigPlugin<ExpoAssistantPluginConfig> = (
  config,
  props
) => {
  return withEntitlementsPlist(config, (cfg) => setEntitlements(cfg, props));
};

export function setEntitlements(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): ExportedConfigWithProps {
  const { ios = {} } = props;

  // Add SiriKit entitlement
  if (props.enableSiriKit !== false) {
    config.modResults["com.apple.developer.siri"] = true;
  }

  // Add App Groups for data sharing with extensions
  if (ios.appGroups && ios.appGroups.length > 0) {
    config.modResults["com.apple.security.application-groups"] = ios.appGroups;
  } else if (ios.intentExtensionBundleId) {
    // Create default app group if intent extension is enabled
    const bundleId = config.ios?.bundleIdentifier || "com.yourapp";
    config.modResults["com.apple.security.application-groups"] = [
      `group.${bundleId}.voiceassistant`,
    ];
  }

  // Add HealthKit entitlement if enabled
  if (props.enableHealthKit) {
    config.modResults["com.apple.developer.healthkit"] = true;
    config.modResults["com.apple.developer.healthkit.background-delivery"] =
      true;
  }

  // Add Media Session entitlement if enabled
  if (props.enableMediaSession) {
    config.modResults["com.apple.developer.playable-content"] = true;
  }

  if (props.debugMode) {
    console.log("[expo-assistant] iOS entitlements configured");
  }

  return config;
}
