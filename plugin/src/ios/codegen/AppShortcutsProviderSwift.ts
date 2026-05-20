/**
 * Top-level provider file assembly.
 *
 * Composes the per-shortcut typed intent structs, declared enum
 * structs, declared entity structs (entity + query), the ISO8601
 * helper, the AppShortcutsProvider struct itself, and the Apple-doc
 * reference comment block into the full `AppShortcutsBridge.generated.swift`
 * source string the mod writes to disk.
 *
 * Pure: takes config in, returns a Swift source string out. The mod
 * (`withIOSAppShortcutsCodegen.ts`) handles validation of cross-
 * declaration references AND the side effects (writing the file +
 * registering in pbxproj).
 */

import type {
  AppEntityDeclaration,
  AppEnumDeclaration,
  AppShortcutParameter,
} from "../../types";
import { generateAppEntityStructs } from "./AppEntitySwift";
import { generateAppEnumStruct } from "./AppEnumSwift";
import { buildPhraseLiteral } from "./PhraseLiteral";
import { generateTypedIntentStruct } from "./TypedIntentSwift";
import { escapeSwift, intentStructName } from "./types";

export interface AppShortcutDeclaration {
  id: string;
  title: string;
  phrases?: string[];
  systemImageName?: string;
  parameters?: AppShortcutParameter[];
}

export interface RenderInput {
  shortcuts: AppShortcutDeclaration[];
  enums: AppEnumDeclaration[];
  entities: AppEntityDeclaration[];
}

/**
 * Generates the complete AppShortcutsBridge.generated.swift source.
 *
 * The output structure (top to bottom):
 *
 *   1. Auto-generated banner comment + Apple framework reference URLs
 *   2. Imports (AppIntents, ExpoAssistant, Foundation)
 *   3. Generated AppEnum structs (per declared enum)
 *   4. Generated AppEntity + EntityStringQuery struct pairs (per declared entity)
 *   5. ISO8601 formatter helper (only when any Date param exists)
 *   6. Generated typed AppIntent structs (per shortcut with declared parameters)
 *   7. ExpoAssistantParametersRefresher @objc helper (only when any entity exists)
 *   8. ExpoAssistantAppShortcuts: AppShortcutsProvider with the appShortcuts array
 */
export function renderAppShortcutsProviderFile(input: RenderInput): string {
  const { shortcuts, enums, entities } = input;

  const enumStructs = enums.map(generateAppEnumStruct);
  const entityStructs = entities.flatMap(generateAppEntityStructs);

  const hasEntities = entities.length > 0;
  const typedIntentStructs: string[] = [];
  const appShortcutEntries: string[] = [];

  let needsISO8601 = false;
  let hasMeasurement = false;
  let hasURL = false;

  for (const s of shortcuts) {
    const params = s.parameters ?? [];
    const hasTypedParams = params.length > 0;

    if (params.some((p) => p.type === "date")) needsISO8601 = true;
    if (params.some((p) => p.type === "duration" || p.type === "length")) {
      hasMeasurement = true;
    }
    if (params.some((p) => p.type === "url")) hasURL = true;

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
  const entityBlock = entityStructs.length
    ? `\n${entityStructs.join("\n\n")}\n`
    : "";
  const typedStructsBlock = typedIntentStructs.length
    ? `\n${typedIntentStructs.join("\n\n")}\n`
    : "";
  const iso8601Block = needsISO8601
    ? `\n@available(iOS 16.0, *)\nfileprivate let _expoAssistantISO8601Formatter: ISO8601DateFormatter = {\n    let f = ISO8601DateFormatter()\n    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]\n    return f\n}()\n`
    : "";

  // Refresher helper for `updateAppShortcutParameters()`. Lives in
  // the app target so it can reference the generated
  // `ExpoAssistantAppShortcuts` type. The pod looks it up via
  // NSClassFromString — see ExpoAssistantModule.swift's
  // `updateAppShortcutParameters` AsyncFunction.
  const refresherBlock = hasEntities
    ? `\n@available(iOS 16.4, *)\n@objc(ExpoAssistantParametersRefresher)\npublic class ExpoAssistantParametersRefresher: NSObject {\n    @objc public static func refresh() {\n        ExpoAssistantAppShortcuts.updateAppShortcutParameters()\n    }\n}\n`
    : "";

  const appleRefLines = buildAppleRefBlock({
    hasEnums: enums.length > 0,
    hasEntities,
    hasDate: needsISO8601,
    hasMeasurement,
    hasURL,
    hasTypedIntents: typedIntentStructs.length > 0,
  });

  return `// AUTO-GENERATED by expo-assistant. Do not edit by hand.
// Regenerated on every \`expo prebuild --platform ios\`.
//
// Declares the AppShortcutsProvider for this app. iOS 16+ scans for one
// per app; this file IS that provider. Shortcut entries come from
// \`app.json\` → \`expo.plugins\` → expo-assistant → \`ios.appShortcuts\`.
//
// Shortcuts with a declared \`parameters\` array get a dedicated typed
// AppIntent struct generated below; everything else falls back to
// \`GenericVoiceIntent\` shipped by the pod for backwards compatibility.
// Declared enums (ios.enums[]) and entities (ios.entities[]) are
// emitted first as AppEnum / AppEntity-conforming types so the typed
// intent structs can reference them.
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
${enumBlock}${entityBlock}${iso8601Block}${typedStructsBlock}${refresherBlock}
@available(iOS 16.0, *)
public struct ExpoAssistantAppShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
${arrayBody}
    }
}
`;
}

/**
 * Returns a // comment block listing the canonical Apple doc URLs for
 * every Apple type the generated file uses. Conditionally includes
 * entries based on which features the developer's app.json declared,
 * so the header stays informative without becoming wall-of-text on
 * minimal apps.
 */
export function buildAppleRefBlock(flags: {
  hasEnums: boolean;
  hasEntities: boolean;
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
  if (flags.hasEnums || flags.hasEntities) {
    lines.push(
      "//   TypeDisplayRepresentation — https://developer.apple.com/documentation/appintents/typedisplayrepresentation",
      "//   DisplayRepresentation — https://developer.apple.com/documentation/appintents/displayrepresentation"
    );
  }
  if (flags.hasEnums) {
    lines.push(
      "//   AppEnum              — https://developer.apple.com/documentation/appintents/appenum"
    );
  }
  if (flags.hasEntities) {
    lines.push(
      "//   AppEntity            — https://developer.apple.com/documentation/appintents/appentity",
      "//   EntityStringQuery    — https://developer.apple.com/documentation/appintents/entitystringquery",
      "//   EntityQuery          — https://developer.apple.com/documentation/appintents/entityquery"
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
