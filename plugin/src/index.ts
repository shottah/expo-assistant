/**
 * Main config plugin for expo-assistant
 */

import { ConfigPlugin, withPlugins } from '@expo/config-plugins';
import { ExpoAssistantPluginConfig } from './types';
import { withIOSVoiceIntents } from './withIOSVoiceIntents';
import { withAndroidVoiceIntents } from './withAndroidVoiceIntents';

const withExpoAssistant: ConfigPlugin<ExpoAssistantPluginConfig> = (config, props = {}) => {
  const pluginConfig: ExpoAssistantPluginConfig = {
    // Default values
    enableSiriKit: true,
    enableAppIntents: true,
    enableAppActions: true,
    enableBackgroundExecution: false,
    intents: [],
    debugMode: false,
    ...props
  };

  if (pluginConfig.debugMode) {
    console.log('[expo-assistant] Plugin configuration:', JSON.stringify(pluginConfig, null, 2));
  }

  return withPlugins(config, [
    // iOS configuration
    [withIOSVoiceIntents, pluginConfig],
    // Android configuration
    [withAndroidVoiceIntents, pluginConfig]
  ]);
};

export default withExpoAssistant;
export { ExpoAssistantPluginConfig, IntentCategory } from './types';