/**
 * Top-level config plugin for expo-assistant.
 *
 * Composes the iOS + Android platform plugins, applies defaults to the
 * user's props, and wraps the whole thing in `createRunOncePlugin` so
 * accidentally composing this plugin twice (e.g. from a meta-plugin AND
 * from app.json directly) is a no-op instead of doubling every side
 * effect.
 *
 * Pattern matches every first-party Expo plugin we audited
 * (expo-tracking-transparency, expo-camera, expo-notifications,
 * expo-dev-client, expo-asset). See `.plan/07-plugin-audit.md § 7`.
 */

import {
  ConfigPlugin,
  createRunOncePlugin,
  withPlugins,
} from "@expo/config-plugins";

import { withIOSVoiceIntents } from "./ios";
import { ExpoAssistantPluginConfig } from "./types";
import { withAndroidVoiceIntents } from "./withAndroidVoiceIntents";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require("../../package.json");

const withExpoAssistant: ConfigPlugin<ExpoAssistantPluginConfig> = (
  config,
  props = {}
) => {
  const pluginConfig: ExpoAssistantPluginConfig = {
    // Default values
    enableSiriKit: true,
    enableAppIntents: true,
    enableAppActions: true,
    enableBackgroundExecution: false,
    intents: [],
    debugMode: false,
    ...props,
  };

  if (pluginConfig.debugMode) {
    console.log(
      "[expo-assistant] Plugin configuration:",
      JSON.stringify(pluginConfig, null, 2)
    );
  }

  return withPlugins(config, [
    // iOS configuration
    [withIOSVoiceIntents, pluginConfig],
    // Android configuration
    [withAndroidVoiceIntents, pluginConfig],
  ]);
};

export default createRunOncePlugin(withExpoAssistant, pkg.name, pkg.version);
export { ExpoAssistantPluginConfig, IntentCategory } from "./types";
