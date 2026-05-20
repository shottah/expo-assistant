/**
 * iOS config plugin for expo-assistant
 * Handles Info.plist, entitlements, and Intent Extension setup
 */

import {
  ConfigPlugin,
  withInfoPlist,
  withEntitlementsPlist,
  withXcodeProject,
  IOSConfig,
  ExportedConfigWithProps,
} from "@expo/config-plugins";
import fs from "fs";
import path from "path";

import {
  AppEnumDeclaration,
  AppShortcutParameter,
  ExpoAssistantPluginConfig,
  INTENT_TYPE_MAPPINGS,
} from "./types";

export const withIOSVoiceIntents: ConfigPlugin<ExpoAssistantPluginConfig> = (
  config,
  props
) => {
  config = withInfoPlist(config, (config) => {
    return setInfoPlist(config, props);
  });

  config = withEntitlementsPlist(config, (config) => {
    return setEntitlements(config, props);
  });

  // Always run the AppShortcuts codegen, even when no shortcuts are
  // configured — the base AppShortcutsBridge.swift references
  // `generatedShortcuts`, so the extension file must always exist (with
  // an empty list if nothing is declared) for the iOS module to compile.
  config = withGeneratedAppShortcuts(config, props);

  if (
    props.ios?.intentExtensionBundleId ||
    props.intents?.includes("custom" as any)
  ) {
    config = withXcodeProject(config, (config) => {
      return createIntentExtension(config, props);
    });
  }

  return config;
};

/**
 * Generates `ios/<ProjectName>/AppShortcutsBridge.generated.swift`
 * containing the full `ExpoAssistantAppShortcuts: AppShortcutsProvider`
 * declaration plus the developer's declared shortcuts, AND registers
 * the file in the Xcode project's build sources so it actually compiles
 * into the app binary.
 *
 * Lives inside the iOS app's target (not the pod) so iOS scans it at
 * launch — `AppShortcutsProvider` is scanned per app, not per
 * framework. The pod ships only `GenericVoiceIntent`
 * (`ios/AppShortcutsBridge.swift`); the per-app provider lives here.
 *
 * Always runs, even with an empty shortcut list — the file is
 * unconditional so a developer who hasn't declared any shortcuts still
 * has a valid (empty) provider and the app compiles.
 *
 * Why a single `withXcodeProject` mod instead of `withDangerousMod` for
 * the write + a separate mod for the pbxproj registration: writing the
 * .swift file to disk is necessary but not sufficient. `expo prebuild`
 * scans the project template at template-generation time; files written
 * later are NOT auto-added to the pbxproj. Without an explicit
 * `addBuildSourceFileToGroup` call the file sits on disk and Xcode
 * skips it, so the OS never sees an `AppShortcutsProvider` to scan.
 * Doing both in the same `withXcodeProject` mod gives us pbxproj access
 * AND lets us write the file immediately before registering it.
 */
function withGeneratedAppShortcuts(
  config: any,
  props: ExpoAssistantPluginConfig
): any {
  return withXcodeProject(config, async (cfg: any) => {
    const shortcuts = props.ios?.appShortcuts ?? [];
    const projectName =
      cfg.modRequest.projectName ?? cfg.name ?? "ExpoAssistantApp";

    // Path inside the app target directory (Xcode group root).
    const relativePath = path.join(
      projectName,
      "AppShortcutsBridge.generated.swift"
    );
    const absolutePath = path.join(
      cfg.modRequest.platformProjectRoot,
      relativePath
    );

    const declaredEnums = props.ios?.enums ?? [];
    const enumNames = new Set(declaredEnums.map((e) => e.name));

    // Validate every enum-typed parameter references a declared enum
    // and that no `enum:` parameter slips through with an unknown name.
    for (const s of shortcuts) {
      for (const p of s.parameters ?? []) {
        if (typeof p.type === "string" && p.type.startsWith("enum:")) {
          const referenced = p.type.slice("enum:".length);
          if (!enumNames.has(referenced)) {
            throw new Error(
              `[expo-assistant] Parameter "${p.name}" on shortcut "${s.id}" references enum "${referenced}" which is not declared in ios.enums[]. ` +
                `Add a matching { name: "${referenced}", cases: [...] } entry under ios.enums.`
            );
          }
        }
      }
    }

    const enumStructs = declaredEnums.map(generateAppEnumStruct);
    const typedIntentStructs: string[] = [];
    const appShortcutEntries: string[] = [];

    let needsISO8601 = false;

    for (const s of shortcuts) {
      const params = s.parameters ?? [];
      const hasTypedParams = params.length > 0;

      if (params.some((p) => p.type === "date")) needsISO8601 = true;

      const rawPhrases = s.phrases ?? [`\${applicationName}`];
      const phraseLiterals = rawPhrases.map((p) =>
        buildPhraseLiteral(p, s.id, params)
      );

      const intentExpr = hasTypedParams
        ? `${intentStructName(s.id)}()`
        : `GenericVoiceIntent(intentId: "${escapeSwift(s.id)}")`;

      appShortcutEntries.push(
        `            AppShortcut(\n` +
          `                intent: ${intentExpr},\n` +
          `                phrases: [${phraseLiterals.join(", ")}],\n` +
          `                shortTitle: "${escapeSwift(s.title)}",\n` +
          `                systemImageName: "${escapeSwift(s.systemImageName ?? "mic")}"\n` +
          `            )`
      );

      if (hasTypedParams) {
        typedIntentStructs.push(
          generateTypedIntentStruct(intentStructName(s.id), s.id, s.title, params)
        );
      }
    }

    const arrayBody =
      appShortcutEntries.length === 0
        ? "        return [AppShortcut]()"
        : `        return [\n${appShortcutEntries.join(",\n")}\n        ]`;

    const enumBlock = enumStructs.length
      ? `\n${enumStructs.join("\n\n")}\n`
      : "";
    const typedStructsBlock = typedIntentStructs.length
      ? `\n${typedIntentStructs.join("\n\n")}\n`
      : "";
    const iso8601Block = needsISO8601
      ? `\n@available(iOS 16.0, *)\nfileprivate let _expoAssistantISO8601Formatter: ISO8601DateFormatter = {\n    let f = ISO8601DateFormatter()\n    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]\n    return f\n}()\n`
      : "";

    const appleRefLines = buildAppleRefBlock({
      hasEnums: declaredEnums.length > 0,
      hasDate: needsISO8601,
      hasMeasurement: shortcuts.some((s) =>
        (s.parameters ?? []).some((p) => p.type === "duration" || p.type === "length")
      ),
      hasURL: shortcuts.some((s) =>
        (s.parameters ?? []).some((p) => p.type === "url")
      ),
      hasTypedIntents: typedIntentStructs.length > 0,
    });

    const swift = `// AUTO-GENERATED by expo-assistant. Do not edit by hand.
// Regenerated on every \`expo prebuild --platform ios\`.
//
// Declares the AppShortcutsProvider for this app. iOS 16+ scans for one
// per app; this file IS that provider. Shortcut entries come from
// \`app.json\` → \`expo.plugins\` → expo-assistant → \`ios.appShortcuts\`.
//
// Shortcuts with a declared \`parameters\` array get a dedicated typed
// AppIntent struct generated below; everything else falls back to
// \`GenericVoiceIntent\` shipped by the pod for backwards compatibility.
// Declared enums (ios.enums[]) are emitted first as AppEnum-conforming
// types so the typed intent structs can reference them.
//
// Apple framework reference docs for the types used below:
${appleRefLines}
//
// See AGENTS.md → "Reference docs" in the expo-assistant repo for
// guidance on when to consult each one and what's documented vs
// empirically observed (notably the AppShortcutPhrase
// parameter-type constraint, issue #37).

import AppIntents
import ExpoAssistant
import Foundation
${enumBlock}${iso8601Block}${typedStructsBlock}
@available(iOS 16.0, *)
public struct ExpoAssistantAppShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
${arrayBody}
    }
}
`;

    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, swift, "utf8");

    // Register the file in the app target's Compile Sources build phase.
    // Idempotent — re-running prebuild re-writes the file and the helper
    // skips an already-present pbxproj entry by path match.
    const project = cfg.modResults;
    const alreadyRegistered =
      JSON.stringify(project.hash?.project ?? {}).includes(
        "AppShortcutsBridge.generated.swift"
      );
    if (!alreadyRegistered) {
      IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
        filepath: relativePath,
        groupName: projectName,
        project,
      });
    }

    return cfg;
  });
}

function escapeSwift(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Returns a // comment block listing the canonical Apple doc URLs for
 * every Apple type the generated file uses. Conditionally includes
 * entries based on which features the developer's app.json declared,
 * so the header stays informative without becoming wall-of-text on
 * minimal apps.
 */
function buildAppleRefBlock(flags: {
  hasEnums: boolean;
  hasDate: boolean;
  hasMeasurement: boolean;
  hasURL: boolean;
  hasTypedIntents: boolean;
}): string {
  const lines: string[] = [
    "//   AppShortcutsProvider — https://developer.apple.com/documentation/appintents/appshortcutsprovider",
    "//   AppShortcut          — https://developer.apple.com/documentation/appintents/appshortcut",
    "//   AppShortcutPhrase    — https://developer.apple.com/documentation/appintents/appshortcutphrase",
    "//   AppIntent            — https://developer.apple.com/documentation/appintents/appintent",
  ];
  if (flags.hasTypedIntents) {
    lines.push(
      "//   @Parameter           — https://developer.apple.com/documentation/appintents/parameter",
      "//   ParameterSummary     — https://developer.apple.com/documentation/appintents/parametersummary",
      "//   IntentResult         — https://developer.apple.com/documentation/appintents/intentresult"
    );
  }
  if (flags.hasEnums) {
    lines.push(
      "//   AppEnum              — https://developer.apple.com/documentation/appintents/appenum",
      "//   TypeDisplayRepresentation — https://developer.apple.com/documentation/appintents/typedisplayrepresentation",
      "//   DisplayRepresentation — https://developer.apple.com/documentation/appintents/displayrepresentation"
    );
  }
  if (flags.hasDate) {
    lines.push(
      "//   ISO8601DateFormatter — https://developer.apple.com/documentation/foundation/iso8601dateformatter"
    );
  }
  if (flags.hasMeasurement) {
    lines.push(
      "//   Measurement          — https://developer.apple.com/documentation/foundation/measurement",
      "//   UnitDuration         — https://developer.apple.com/documentation/foundation/unitduration",
      "//   UnitLength           — https://developer.apple.com/documentation/foundation/unitlength"
    );
  }
  if (flags.hasURL) {
    lines.push(
      "//   URL                  — https://developer.apple.com/documentation/foundation/url"
    );
  }
  return lines.join("\n");
}

/**
 * Translates an app.json shortcut `id` to the Swift type name used for
 * its generated AppIntent struct. Suffixes `Intent` and PascalCases
 * the id so kebab/snake/camel/spaced forms all converge:
 *
 *   "create-event"  → "CreateEventIntent"
 *   "create_event"  → "CreateEventIntent"
 *   "createEvent"   → "CreateEventIntent"
 *   "create event"  → "CreateEventIntent"
 */
function intentStructName(id: string): string {
  const segments = id
    .split(/[-_\s]+/)
    .flatMap((s) => s.split(/(?=[A-Z])/))
    .filter((s) => s.length > 0)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  if (segments.length === 0) {
    throw new Error(
      `[expo-assistant] cannot derive a Swift type name from empty shortcut id`
    );
  }
  return `${segments.join("")}Intent`;
}

function isEnumType(type: AppShortcutParameter["type"]): boolean {
  return typeof type === "string" && type.startsWith("enum:");
}

function enumNameFromType(type: AppShortcutParameter["type"]): string {
  if (!isEnumType(type)) {
    throw new Error(
      `[expo-assistant] enumNameFromType called with non-enum type: ${type}`
    );
  }
  return (type as string).slice("enum:".length);
}

function swiftTypeFor(type: AppShortcutParameter["type"]): string {
  if (isEnumType(type)) {
    return enumNameFromType(type);
  }
  switch (type) {
    case "string":
      return "String";
    case "number":
      return "Double";
    case "boolean":
      return "Bool";
    case "date":
      return "Date";
    case "duration":
      return "Measurement<UnitDuration>";
    case "length":
      return "Measurement<UnitLength>";
    case "url":
      return "URL";
    default: {
      // Exhaustiveness assertion — the union is closed; this branch is
      // unreachable but TS needs help inferring that with the template
      // literal type in play.
      const exhaustive: never = type as never;
      throw new Error(
        `[expo-assistant] unknown parameter type: ${String(exhaustive)}`
      );
    }
  }
}

/**
 * Swift expression that marshals a typed parameter into a JS-friendly
 * value for `emitIntent`'s `[String: Any]` dict. Each rich type lands
 * with a documented shape on the JS side:
 *
 *   Date            → ISO 8601 string
 *   Measurement<T>  → ["value": Double, "unit": String]  (unit is the symbol, e.g. "s", "km")
 *   URL             → absoluteString
 *   AppEnum         → rawValue (String)
 *   Primitives      → passed through unchanged
 */
function marshalExpr(p: AppShortcutParameter): string {
  if (isEnumType(p.type)) return `${p.name}.rawValue`;
  switch (p.type) {
    case "string":
    case "number":
    case "boolean":
      return p.name;
    case "date":
      return `_expoAssistantISO8601Formatter.string(from: ${p.name})`;
    case "duration":
    case "length":
      return `["value": ${p.name}.value, "unit": ${p.name}.unit.symbol] as [String: Any]`;
    case "url":
      return `${p.name}.absoluteString`;
    default: {
      const exhaustive: never = p.type as never;
      throw new Error(
        `[expo-assistant] no marshal expression for type: ${String(exhaustive)}`
      );
    }
  }
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Generates the Swift `AppEnum`-conforming struct for a declared enum.
 * Each case becomes `case <id>` with a matching entry in
 * `caseDisplayRepresentations`. `AppEnum` is one of two types Apple's
 * `AppShortcutPhrase` accepts as voice slots (the other is
 * `AppEntity`), so enum-typed parameters can appear in phrase
 * templates via `${paramName}`.
 */
function generateAppEnumStruct(decl: AppEnumDeclaration): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(decl.name)) {
    throw new Error(
      `[expo-assistant] enum name "${decl.name}" is not a valid Swift identifier`
    );
  }
  if (decl.cases.length === 0) {
    throw new Error(
      `[expo-assistant] enum "${decl.name}" must declare at least one case`
    );
  }
  for (const c of decl.cases) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(c.id)) {
      throw new Error(
        `[expo-assistant] enum "${decl.name}" case id "${c.id}" is not a valid Swift identifier`
      );
    }
  }

  const displayNameEsc = escapeSwift(decl.displayName ?? decl.name);
  const caseLines = decl.cases.map((c) => `    case ${c.id}`).join("\n");
  const displayEntries = decl.cases
    .map((c) => `        .${c.id}: "${escapeSwift(c.display)}",`)
    .join("\n");

  return `@available(iOS 16.0, *)
public enum ${decl.name}: String, AppEnum {
${caseLines}

    public static var typeDisplayRepresentation: TypeDisplayRepresentation = "${displayNameEsc}"

    public static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [
${displayEntries}
    ]
}`;
}

/**
 * Generates a dedicated AppIntent Swift struct for a shortcut with
 * declared parameters. Each parameter becomes an `@Parameter` with
 * `requestValueDialog` sourced from `prompt`; `parameterSummary`
 * references every parameter so iOS's tap-from-Library flow walks the
 * user through each unbound value via the needs-value prompt path.
 * `perform()` marshals the full parameter dict back through
 * `ExpoAssistantModule.shared?.emitIntent(id:parameters:)` — the same
 * bridge GenericVoiceIntent uses, so the JS handler routing surface
 * doesn't have to know which intent flavor fired.
 */
function generateTypedIntentStruct(
  structName: string,
  id: string,
  title: string,
  params: AppShortcutParameter[]
): string {
  const titleEsc = escapeSwift(title);

  const paramDecls = params
    .map((p) => {
      const paramTitleEsc = escapeSwift(p.title ?? capitalize(p.name));
      const dialog = p.prompt
        ? `,\n        requestValueDialog: "${escapeSwift(p.prompt)}"`
        : "";
      return `    @Parameter(\n        title: "${paramTitleEsc}"${dialog}\n    )\n    public var ${p.name}: ${swiftTypeFor(p.type)}`;
    })
    .join("\n\n");

  const summaryInterpolations = params
    .map((p) => `\\(\\.$${p.name})`)
    .join(" ");
  const summaryBody = `${titleEsc} ${summaryInterpolations}`;

  const dictEntries = params
    .map((p) => `                    "${p.name}": ${marshalExpr(p)}`)
    .join(",\n");

  return `@available(iOS 16.0, *)
public struct ${structName}: AppIntent {
    public static var title: LocalizedStringResource = "${titleEsc}"

    public static var parameterSummary: some ParameterSummary {
        Summary("${summaryBody}")
    }

${paramDecls}

    public init() {}

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            ExpoAssistantModule.shared?.emitIntent(
                id: "${escapeSwift(id)}",
                parameters: [
${dictEntries}
                ]
            )
        }
        return .result()
    }
}`;
}

/**
 * Emits a Swift string literal for an AppShortcut phrase.
 *
 * Rules iOS enforces (we enforce them earlier with a clear error so
 * developers don't see silent linkd rejections):
 *
 * 1. Every phrase must contain `${applicationName}`. Apple's `linkd`
 *    drops phrases missing it.
 * 2. `${paramName}` slots in phrases only work when the parameter
 *    resolves to an `AppEntity` or `AppEnum` — never a primitive
 *    (`String`, `Int`, `Double`, `Date`, `URL`, `Measurement`). Per
 *    Apple DTS engineer Ed Ford: *"Invalid parameter type. AppEntity
 *    and AppEnum are the only allowed types"*
 *    (https://developer.apple.com/forums/thread/770037). We throw at
 *    prebuild on any primitive slot — see issue #37.
 *
 * Slots referencing enum-typed parameters ARE legal (#29 unlocks them)
 * and emit raw Swift parameter interpolation `\(\.$paramName)` so iOS
 * extracts the spoken value into the bound parameter.
 *
 * `${applicationName}` is emitted as `\(.applicationName)` — Swift
 * compile-time syntax, not runtime characters; the backslash must not
 * pass through escapeSwift.
 */
function buildPhraseLiteral(
  phrase: string,
  intentId: string,
  declaredParams: AppShortcutParameter[]
): string {
  const APP_NAME_TOKEN = "${applicationName}";
  if (!phrase.includes(APP_NAME_TOKEN)) {
    throw new Error(
      `[expo-assistant] iOS AppShortcut phrase for "${intentId}" must contain "${APP_NAME_TOKEN}" — got: ${JSON.stringify(phrase)}. Apple silently drops phrases missing this token.`
    );
  }

  const declaredByName = new Map(declaredParams.map((p) => [p.name, p]));
  const TOKEN_RE = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  const parts: string[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(phrase)) !== null) {
    const token = m[1];
    parts.push(escapeSwift(phrase.slice(cursor, m.index)));

    if (token === "applicationName") {
      parts.push("\\(.applicationName)");
    } else {
      const param = declaredByName.get(token);
      if (!param) {
        throw new Error(
          `[expo-assistant] Phrase for "${intentId}" references undeclared parameter "\${${token}}". ` +
            `Either declare it in ios.appShortcuts[].parameters or remove the slot from the phrase. ` +
            `Note: voice slots only work for AppEnum / AppEntity types (#37), not primitives.`
        );
      }
      if (!isEnumType(param.type)) {
        throw new Error(
          `[expo-assistant] Phrase for "${intentId}" references "\${${token}}" as a voice slot, but "${token}" is type "${param.type}". ` +
            `Apple's AppShortcutPhrase only accepts AppEntity / AppEnum types as voice slots (https://developer.apple.com/forums/thread/770037) — primitives are silently dropped by linkd. ` +
            `Either change "${token}" to an enum (declare under ios.enums[] and set type: "enum:<Name>") OR remove the slot and rely on requestValueDialog to prompt for "${token}". Tracked in #37.`
        );
      }
      // Legal enum-typed slot: emit raw Swift parameter interpolation.
      parts.push(`\\(\\.$${token})`);
    }

    cursor = m.index + m[0].length;
  }
  parts.push(escapeSwift(phrase.slice(cursor)));
  return `"${parts.join("")}"`;
}

function setInfoPlist(
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

function setEntitlements(
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

  // Get Xcode project
  // Note: These are used for Xcode project manipulation in full implementation
  // const project = config.modResults;
  // const projectName = config.modRequest.projectName || 'MyApp';

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

  // Add Intent Extension to Xcode project
  // The legacy IntentExtension path (this function) is preserved for apps
  // that explicitly opt in via `ios.intentExtensionBundleId` or
  // `intents: ["custom"]`. For iOS 16+, prefer the AppShortcuts pipeline:
  // declare `ios.appShortcuts` in app.json and the
  // `withGeneratedAppShortcuts` mod produces a runnable provider without
  // requiring any manual Xcode target wiring.

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
