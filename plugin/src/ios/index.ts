/**
 * iOS plugin composer.
 *
 * Thin sequence of single-concern mods. Each `with*` here owns ONE
 * concern (one Info.plist / entitlements / xcodeproj surface). The
 * pattern follows `expo-notifications/plugin/src/withNotifications.ts`
 * and `expo-build-properties/src/withBuildProperties.ts`.
 *
 * The codegen logic itself lives in `./codegen/` as pure functions
 * (no fs, no mod plumbing) so each generator can be unit-tested in
 * isolation. See `.plan/07-plugin-audit.md § 1` for the full
 * rationale.
 */

import { ConfigPlugin } from "@expo/config-plugins";

import { ExpoAssistantPluginConfig } from "../types";
import { withIOSAppShortcutsCodegen } from "./withIOSAppShortcutsCodegen";
import { withIOSEntitlements } from "./withIOSEntitlements";
import { withIOSInfoPlist } from "./withIOSInfoPlist";
import { withIOSIntentExtension } from "./withIOSIntentExtension";

export const withIOSVoiceIntents: ConfigPlugin<ExpoAssistantPluginConfig> = (
  config,
  props
) => {
  config = withIOSInfoPlist(config, props);
  config = withIOSEntitlements(config, props);
  // AppShortcuts codegen always runs (even with zero declared
  // shortcuts) so the app target still gets a valid empty provider
  // that compiles.
  config = withIOSAppShortcutsCodegen(config, props);
  // IntentExtension is a no-op unless the developer opted in via
  // `ios.intentExtensionBundleId` or `intents: ["custom"]`. The gate
  // lives inside the mod itself.
  config = withIOSIntentExtension(config, props);
  return config;
};

// Re-export internals for plugin consumers and tests that want to
// reach individual mods or the pure codegen helpers without going
// through the composer.
export { withIOSAppShortcutsCodegen } from "./withIOSAppShortcutsCodegen";
export { withIOSEntitlements, setEntitlements } from "./withIOSEntitlements";
export { withIOSInfoPlist, setInfoPlist } from "./withIOSInfoPlist";
export { withIOSIntentExtension } from "./withIOSIntentExtension";
