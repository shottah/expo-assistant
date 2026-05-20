/**
 * AppShortcuts codegen mod.
 *
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
 *
 * This file is the SIDE-EFFECT layer. All Swift source generation +
 * cross-reference validation lives in `codegen/` as pure functions
 * (see `codegen/AppShortcutsProviderSwift.ts`, `codegen/types.ts`, etc.).
 */

import {
  ConfigPlugin,
  IOSConfig,
  withXcodeProject,
} from "@expo/config-plugins";
import fs from "fs";
import path from "path";

import { ExpoAssistantPluginConfig } from "../types";
import { pluginError } from "../utils/errors";
import { renderAppShortcutsProviderFile } from "./codegen/AppShortcutsProviderSwift";

const GENERATED_FILENAME = "AppShortcutsBridge.generated.swift";

export const withIOSAppShortcutsCodegen: ConfigPlugin<
  ExpoAssistantPluginConfig
> = (config, props) => {
  return withXcodeProject(config, async (cfg: any) => {
    const shortcuts = props.ios?.appShortcuts ?? [];
    const enums = props.ios?.enums ?? [];
    const entities = props.ios?.entities ?? [];

    validateCrossReferences(shortcuts, enums, entities);

    const projectName =
      cfg.modRequest.projectName ?? cfg.name ?? "ExpoAssistantApp";

    // Path inside the app target directory (Xcode group root).
    const relativePath = path.join(projectName, GENERATED_FILENAME);
    const absolutePath = path.join(
      cfg.modRequest.platformProjectRoot,
      relativePath
    );

    const swift = renderAppShortcutsProviderFile({
      shortcuts,
      enums,
      entities,
    });

    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, swift, "utf8");

    registerInPbxproj(cfg.modResults, projectName, relativePath);

    return cfg;
  });
};

/**
 * Verifies that every `parameters[].type` of the form `enum:<Name>` or
 * `entity:<Name>` references something actually declared under
 * `ios.enums[]` or `ios.entities[]`. Catches typos at prebuild time
 * rather than letting the generated Swift reference an undefined type
 * and fail at xcodebuild.
 */
function validateCrossReferences(
  shortcuts: NonNullable<NonNullable<ExpoAssistantPluginConfig["ios"]>["appShortcuts"]>,
  enums: NonNullable<NonNullable<ExpoAssistantPluginConfig["ios"]>["enums"]>,
  entities: NonNullable<NonNullable<ExpoAssistantPluginConfig["ios"]>["entities"]>
): void {
  const enumNames = new Set(enums.map((e) => e.name));
  const entityNames = new Set(entities.map((e) => e.name));

  for (const s of shortcuts) {
    for (const p of s.parameters ?? []) {
      if (typeof p.type !== "string") continue;
      if (p.type.startsWith("enum:")) {
        const referenced = p.type.slice("enum:".length);
        if (!enumNames.has(referenced)) {
          throw pluginError({
            what: `Parameter "${p.name}" on shortcut "${s.id}" references enum "${referenced}" which is not declared in ios.enums[].`,
            why: "Enum-typed parameters must point at a declared enum so the generated Swift can reference the corresponding AppEnum type.",
            how: `Add a matching { name: "${referenced}", cases: [...] } entry under ios.enums, or change the parameter type to match a declared enum.`,
          });
        }
      } else if (p.type.startsWith("entity:")) {
        const referenced = p.type.slice("entity:".length);
        if (!entityNames.has(referenced)) {
          throw pluginError({
            what: `Parameter "${p.name}" on shortcut "${s.id}" references entity "${referenced}" which is not declared in ios.entities[].`,
            why: "Entity-typed parameters must point at a declared entity so the generated Swift can reference the corresponding AppEntity type.",
            how: `Add a matching { name: "${referenced}", properties: [...] } entry under ios.entities, or change the parameter type to match a declared entity.`,
          });
        }
      }
    }
  }
}

/**
 * Registers the generated swift file in the app target's Compile
 * Sources build phase. Idempotent via `project.hasFile(...)` per the
 * convention `expo-notifications` / `expo-splash-screen` use — see
 * `~/Github/expo/packages/expo-notifications/plugin/src/withNotificationsIOS.ts:102-108`
 * and `.plan/07-plugin-audit.md § 3`.
 *
 * `addBuildSourceFileToGroup` short-circuits internally too
 * (createProjectFileForGroup at @expo/config-plugins/.../Xcodeproj.ts:91-96
 * returns null for already-registered paths) so this is belt-and-
 * suspenders. But explicit > implicit, and the convention is what
 * future readers will recognize.
 */
function registerInPbxproj(
  project: any,
  projectName: string,
  relativePath: string
): void {
  if (!project.hasFile(relativePath)) {
    IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: relativePath,
      groupName: projectName,
      project,
    });
  }
}
