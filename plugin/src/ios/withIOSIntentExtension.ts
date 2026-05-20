/**
 * Legacy Intent Extension scaffolder (pre-iOS 16 SiriKit path).
 *
 * This mod runs only when a developer opts in by setting
 * `ios.intentExtensionBundleId` OR by including `"custom"` in
 * `intents[]`. For iOS 16+, the canonical path is the AppShortcuts
 * pipeline (`withIOSAppShortcutsCodegen.ts`) which produces a runnable
 * provider without requiring any Intent Extension target wiring.
 *
 * Kept intact for back-compat. Future iOS-16-or-later refactors should
 * leave this alone unless a developer reports needing the legacy
 * surface.
 */

import {
  ConfigPlugin,
  ExportedConfigWithProps,
  withXcodeProject,
} from "@expo/config-plugins";
import fs from "fs";
import path from "path";

import {
  ExpoAssistantPluginConfig,
  INTENT_TYPE_MAPPINGS,
} from "../types";

export const withIOSIntentExtension: ConfigPlugin<
  ExpoAssistantPluginConfig
> = (config, props) => {
  // Gate: only run when the developer has explicitly opted in.
  if (
    !props.ios?.intentExtensionBundleId &&
    !props.intents?.includes("custom" as any)
  ) {
    return config;
  }
  return withXcodeProject(config, (cfg) => createIntentExtension(cfg, props));
};

function createIntentExtension(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): ExportedConfigWithProps {
  const { ios = {} } = props;
  const projectRoot = config.modRequest.projectRoot;
  const bundleId = config.ios?.bundleIdentifier || "com.yourapp";
  const extensionBundleId =
    ios.intentExtensionBundleId || `${bundleId}.IntentExtension`;
  const extensionName = "IntentExtension";

  // Create Intent Extension directory
  const extensionPath = path.join(projectRoot, "ios", extensionName);
  if (!fs.existsSync(extensionPath)) {
    fs.mkdirSync(extensionPath, { recursive: true });
  }

  // Create Info.plist for Intent Extension
  const extensionInfoPlist = {
    CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
    CFBundleDisplayName: extensionName,
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundleIdentifier: extensionBundleId,
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
    CFBundleShortVersionString: "$(MARKETING_VERSION)",
    CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
    NSExtension: {
      NSExtensionPointIdentifier: "com.apple.intents-service",
      NSExtensionPrincipalClass: `$(PRODUCT_MODULE_NAME).IntentHandler`,
      IntentsSupported: getIntentsSupported(props),
      IntentsRestrictedWhileLocked: getRestrictedIntents(props),
    },
  };

  fs.writeFileSync(
    path.join(extensionPath, "Info.plist"),
    require("plist").build(extensionInfoPlist)
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
        ${
          props.intents?.includes("productivity" as any)
            ? `
        case is INCreateTaskIntent:
            return CreateTaskIntentHandler()`
            : ""
        }
        ${
          props.intents?.includes("health" as any)
            ? `
        case is INStartWorkoutIntent:
            return StartWorkoutIntentHandler()`
            : ""
        }
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
${
  props.intents?.includes("productivity" as any)
    ? `
class CreateTaskIntentHandler: NSObject, INCreateTaskIntentHandling {
    func handle(intent: INCreateTaskIntent, completion: @escaping (INCreateTaskIntentResponse) -> Void) {
        let response = INCreateTaskIntentResponse(code: .success, userActivity: nil)
        completion(response)
    }
}`
    : ""
}
${
  props.intents?.includes("health" as any)
    ? `
class StartWorkoutIntentHandler: NSObject, INStartWorkoutIntentHandling {
    func handle(intent: INStartWorkoutIntent, completion: @escaping (INStartWorkoutIntentResponse) -> Void) {
        let response = INStartWorkoutIntentResponse(code: .success, userActivity: nil)
        completion(response)
    }
}`
    : ""
}
`;

  fs.writeFileSync(
    path.join(extensionPath, "IntentHandler.swift"),
    intentHandlerSwift
  );

  // The legacy IntentExtension path is preserved for apps that
  // explicitly opt in via `ios.intentExtensionBundleId` or
  // `intents: ["custom"]`. For iOS 16+, prefer the AppShortcuts
  // pipeline: declare `ios.appShortcuts` in app.json and the
  // `withIOSAppShortcutsCodegen` mod produces a runnable provider
  // without requiring any manual Xcode target wiring.

  if (props.debugMode) {
    console.log(
      `[expo-assistant] Intent Extension scaffolded at ${extensionPath}`
    );
  }

  return config;
}

function getIntentsSupported(props: ExpoAssistantPluginConfig): string[] {
  const intents: string[] = [];

  if (props.intents) {
    props.intents.forEach((category) => {
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
    restricted.push("INSendPaymentIntent");
    restricted.push("INRequestPaymentIntent");
    restricted.push("INTransferMoneyIntent");
  }

  return restricted;
}
