/**
 * Tests for the expo-assistant config plugin.
 *
 * These tests run the real `@expo/config-plugins` helpers (no mocks) and
 * exercise each registered mod function with a stub `modResults` skeleton,
 * then assert on the actual mutations to Info.plist / entitlements /
 * AndroidManifest. This catches regressions where the plugin silently
 * stops writing a required key.
 */

import fs from "fs";
import os from "os";
import path from "path";

import { ExpoConfig } from "@expo/config-types";

import withExpoAssistant, {
  IntentCategory,
  ExpoAssistantPluginConfig,
} from "../src/index";

// Bare minimum shape required by AndroidConfig.Manifest.getMainApplicationOrThrow
// and getMainActivityOrThrow.
function emptyAndroidManifest() {
  return {
    manifest: {
      $: {
        "xmlns:android": "http://schemas.android.com/apk/res/android",
        package: "com.test.app",
      },
      application: [
        {
          $: { "android:name": ".MainApplication" },
          activity: [
            {
              $: { "android:name": ".MainActivity" },
            },
          ],
        },
      ],
    },
  } as any;
}

function baseConfig(overrides: Partial<ExpoConfig> = {}): ExpoConfig {
  return {
    name: "test-app",
    slug: "test-app",
    version: "1.0.0",
    ios: { bundleIdentifier: "com.test.app" },
    android: { package: "com.test.app" },
    // Required by @expo/config-plugins' withStaticPlugin invariant check.
    _internal: { projectRoot: "/tmp/expo-assistant-test" },
    ...overrides,
  } as ExpoConfig;
}

// Run withExpoAssistant and pick out the registered mods so they can be
// invoked directly. We don't rely on compileModsAsync because the
// dangerous Android mod writes files to disk via fs.writeFileSync — out
// of scope for these unit tests; covered separately at the e2e layer.
function applyPlugin(config: ExpoConfig, props: ExpoAssistantPluginConfig) {
  const result = withExpoAssistant(config, props) as any;
  return {
    runInfoPlist: async (initial: Record<string, unknown> = {}) => {
      const mod = result.mods?.ios?.infoPlist;
      if (!mod) throw new Error("iOS infoPlist mod not registered");
      const out = await mod({ ...result, modResults: initial, modRequest: {} });
      return out.modResults as Record<string, unknown>;
    },
    runEntitlements: async (initial: Record<string, unknown> = {}) => {
      const mod = result.mods?.ios?.entitlements;
      if (!mod) throw new Error("iOS entitlements mod not registered");
      const out = await mod({ ...result, modResults: initial, modRequest: {} });
      return out.modResults as Record<string, unknown>;
    },
    runAndroidManifest: async (initial = emptyAndroidManifest()) => {
      const mod = result.mods?.android?.manifest;
      if (!mod) throw new Error("Android manifest mod not registered");
      const out = await mod({ ...result, modResults: initial, modRequest: {} });
      return out.modResults;
    },
    runIosAppShortcutsCodegen: async (platformProjectRoot: string) => {
      const mod = result.mods?.ios?.xcodeproj;
      if (!mod) throw new Error("iOS xcodeproj mod not registered");
      // Minimal pbxproj stub — the mod calls
      // IOSConfig.XcodeUtils.addBuildSourceFileToGroup which mutates
      // this object. The structure mimics what `xcode` parses from a
      // real pbxproj; we don't assert on the mutations here (the
      // existence of the written swift file is the durable contract).
      const pbxprojStub: any = {
        hash: { project: { objects: {} } },
        getFirstTarget: () => ({ uuid: "TEST_TARGET_UUID" }),
        addSourceFile: () => undefined,
        addPbxGroup: () => ({ uuid: "TEST_GROUP_UUID" }),
        addToPbxFileReferenceSection: () => undefined,
        addToPbxBuildFileSection: () => undefined,
        addToPbxSourcesBuildPhase: () => undefined,
        pbxGroupByName: () => ({ uuid: "TEST_GROUP_UUID", children: [] }),
      };
      try {
        await mod({
          ...result,
          modResults: pbxprojStub,
          modRequest: {
            platformProjectRoot,
            projectName: "test-app",
          },
        });
      } catch (err: any) {
        // Deliberate validation errors from the plugin (prefixed
        // [expo-assistant]) must propagate so tests can assert on them.
        // Only swallow stub-incompatibility throws from
        // addBuildSourceFileToGroup, which the file-write assertion
        // tolerates.
        if (String(err?.message ?? "").startsWith("[expo-assistant]")) {
          throw err;
        }
      }
    },
  };
}

function permissionNames(manifest: any): string[] {
  return (manifest?.manifest?.["uses-permission"] ?? []).map(
    (p: any) => p.$["android:name"]
  );
}

function metaDataNames(manifest: any): string[] {
  const app = manifest?.manifest?.application?.[0];
  return (app?.["meta-data"] ?? []).map((m: any) => m.$["android:name"]);
}

describe("withExpoAssistant — iOS Info.plist mod", () => {
  it("always writes the three voice usage descriptions", async () => {
    const plist = await applyPlugin(baseConfig(), {}).runInfoPlist();
    expect(plist.NSMicrophoneUsageDescription).toEqual(expect.any(String));
    expect(plist.NSSpeechRecognitionUsageDescription).toEqual(
      expect.any(String)
    );
    expect(plist.NSSiriUsageDescription).toEqual(expect.any(String));
  });

  it("uses the caller-supplied Siri usage description when provided", async () => {
    const plist = await applyPlugin(baseConfig(), {
      ios: { siriUsageDescription: "Custom Siri reason" },
    }).runInfoPlist();
    expect(plist.NSSiriUsageDescription).toBe("Custom Siri reason");
  });

  it("writes alternative app names when supplied", async () => {
    const plist = await applyPlugin(baseConfig(), {
      ios: { alternativeAppNames: ["Alt One", "Alt Two"] },
    }).runInfoPlist({ CFBundleDisplayName: "Test App" });
    expect(plist.INAlternativeAppNames).toEqual([
      { INAlternativeAppName: "Alt One" },
      { INAlternativeAppName: "Alt Two" },
    ]);
    expect(plist.CFBundleSpokenName).toBe("Test App");
  });

  it("does not write alternative app name keys when none supplied", async () => {
    const plist = await applyPlugin(baseConfig(), {}).runInfoPlist();
    expect(plist.INAlternativeAppNames).toBeUndefined();
    expect(plist.CFBundleSpokenName).toBeUndefined();
  });

  it("populates NSUserActivityTypes from intent categories", async () => {
    const plist = await applyPlugin(baseConfig(), {
      intents: [IntentCategory.SEARCH, IntentCategory.MEDIA],
    }).runInfoPlist();
    const types = plist.NSUserActivityTypes as string[];
    expect(types).toEqual(
      expect.arrayContaining(["INSearchIntent", "INPlayMediaIntent"])
    );
    expect(types).toEqual(
      expect.arrayContaining(["com.test.app.search", "com.test.app.playMedia"])
    );
  });

  it("dedupes NSUserActivityTypes", async () => {
    const plist = await applyPlugin(baseConfig(), {
      intents: [IntentCategory.SEARCH, IntentCategory.COMMUNICATION],
      ios: { supportedIntentTypes: ["INSearchForMessagesIntent"] },
    }).runInfoPlist();
    const types = plist.NSUserActivityTypes as string[];
    const occurrences = types.filter(
      (t) => t === "INSearchForMessagesIntent"
    ).length;
    expect(occurrences).toBe(1);
  });

  it("adds audio + processing background modes when enableBackgroundExecution is set", async () => {
    const plist = await applyPlugin(baseConfig(), {
      enableBackgroundExecution: true,
    }).runInfoPlist();
    expect(plist.UIBackgroundModes).toEqual(
      expect.arrayContaining(["audio", "processing"])
    );
  });

  it("does not add background modes when enableBackgroundExecution is unset", async () => {
    const plist = await applyPlugin(baseConfig(), {}).runInfoPlist();
    expect(plist.UIBackgroundModes).toBeUndefined();
  });

  it("writes HealthKit usage descriptions when enableHealthKit is set", async () => {
    const plist = await applyPlugin(baseConfig(), {
      enableHealthKit: true,
    }).runInfoPlist();
    expect(plist.NSHealthShareUsageDescription).toEqual(expect.any(String));
    expect(plist.NSHealthUpdateUsageDescription).toEqual(expect.any(String));
  });

  it("writes NSSiriKitDomains when supplied", async () => {
    const plist = await applyPlugin(baseConfig(), {
      ios: { siriKitDomains: ["Messaging", "Payments"] },
    }).runInfoPlist();
    expect(plist.NSSiriKitDomains).toEqual(["Messaging", "Payments"]);
  });
});

describe("withExpoAssistant — iOS entitlements mod", () => {
  it("enables SiriKit by default", async () => {
    const ents = await applyPlugin(baseConfig(), {}).runEntitlements();
    expect(ents["com.apple.developer.siri"]).toBe(true);
  });

  it("does not enable SiriKit when enableSiriKit is explicitly false", async () => {
    const ents = await applyPlugin(baseConfig(), {
      enableSiriKit: false,
    }).runEntitlements();
    expect(ents["com.apple.developer.siri"]).toBeUndefined();
  });

  it("writes app groups when supplied", async () => {
    const ents = await applyPlugin(baseConfig(), {
      ios: { appGroups: ["group.com.test.app"] },
    }).runEntitlements();
    expect(ents["com.apple.security.application-groups"]).toEqual([
      "group.com.test.app",
    ]);
  });

  it("defaults app groups when intentExtensionBundleId is supplied but appGroups is not", async () => {
    const ents = await applyPlugin(baseConfig(), {
      ios: { intentExtensionBundleId: "com.test.app.intents" },
    }).runEntitlements();
    expect(ents["com.apple.security.application-groups"]).toEqual([
      "group.com.test.app.voiceassistant",
    ]);
  });

  it("writes HealthKit entitlements when enableHealthKit is set", async () => {
    const ents = await applyPlugin(baseConfig(), {
      enableHealthKit: true,
    }).runEntitlements();
    expect(ents["com.apple.developer.healthkit"]).toBe(true);
    expect(ents["com.apple.developer.healthkit.background-delivery"]).toBe(
      true
    );
  });
});

describe("withExpoAssistant — Android manifest mod", () => {
  it("adds RECORD_AUDIO, INTERNET, INSTALL_SHORTCUT permissions", async () => {
    const manifest = await applyPlugin(baseConfig(), {}).runAndroidManifest();
    expect(permissionNames(manifest)).toEqual(
      expect.arrayContaining([
        "android.permission.RECORD_AUDIO",
        "android.permission.INTERNET",
        "android.permission.INSTALL_SHORTCUT",
      ])
    );
  });

  it("adds Google Fit permissions when enableGoogleFit is set", async () => {
    const manifest = await applyPlugin(baseConfig(), {
      enableGoogleFit: true,
    }).runAndroidManifest();
    expect(permissionNames(manifest)).toEqual(
      expect.arrayContaining([
        "android.permission.ACTIVITY_RECOGNITION",
        "android.permission.ACCESS_FINE_LOCATION",
      ])
    );
  });

  it("adds media session permissions when enableMediaSession is set", async () => {
    const manifest = await applyPlugin(baseConfig(), {
      enableMediaSession: true,
    }).runAndroidManifest();
    expect(permissionNames(manifest)).toEqual(
      expect.arrayContaining([
        "android.permission.MEDIA_CONTENT_CONTROL",
        "android.permission.WAKE_LOCK",
      ])
    );
  });

  it("does not duplicate permissions across re-runs", async () => {
    const initial = emptyAndroidManifest();
    initial.manifest["uses-permission"] = [
      { $: { "android:name": "android.permission.RECORD_AUDIO" } },
    ];
    const manifest = await applyPlugin(baseConfig(), {}).runAndroidManifest(
      initial
    );
    const recordAudio = permissionNames(manifest).filter(
      (n) => n === "android.permission.RECORD_AUDIO"
    );
    expect(recordAudio).toHaveLength(1);
  });

  it("registers the shortcuts metadata", async () => {
    const manifest = await applyPlugin(baseConfig(), {}).runAndroidManifest();
    expect(metaDataNames(manifest)).toContain("android.app.shortcuts");
  });

  it("adds App Actions test URL metadata when supplied", async () => {
    const manifest = await applyPlugin(baseConfig(), {
      android: { appActionsTestUrl: "https://test.example/actions" },
    }).runAndroidManifest();
    expect(metaDataNames(manifest)).toContain(
      "com.google.android.actions.APP_ACTIONS_TEST_URL"
    );
  });

  it("attaches an autoVerify deep-link intent-filter by default", async () => {
    const manifest = await applyPlugin(baseConfig(), {}).runAndroidManifest();
    const activity = manifest.manifest.application[0].activity[0];
    const filter = activity["intent-filter"]?.[0];
    expect(filter?.$["android:autoVerify"]).toBe("true");
    expect(filter?.data?.[0].$["android:pathPrefix"]).toBe("/action");
  });

  it("omits the deep-link intent-filter when deepLinkVerification is false", async () => {
    const manifest = await applyPlugin(baseConfig(), {
      android: { deepLinkVerification: false },
    }).runAndroidManifest();
    const activity = manifest.manifest.application[0].activity[0];
    expect(activity["intent-filter"]).toBeUndefined();
  });

  it("registers VoiceInteractionService when configured", async () => {
    const manifest = await applyPlugin(baseConfig(), {
      android: { voiceInteractionService: true },
    }).runAndroidManifest();
    const services = manifest.manifest.application[0].service ?? [];
    expect(
      services.find(
        (s: any) => s.$["android:name"] === ".VoiceInteractionService"
      )
    ).toBeDefined();
  });

  it("registers SliceProvider when slicesEnabled is set", async () => {
    const manifest = await applyPlugin(baseConfig(), {
      android: { slicesEnabled: true },
    }).runAndroidManifest();
    const providers = manifest.manifest.application[0].provider ?? [];
    expect(
      providers.find((p: any) => p.$["android:name"] === ".SliceProvider")
    ).toBeDefined();
  });
});

describe("withExpoAssistant — plugin orchestration", () => {
  it("returns a config object with both iOS and Android mods registered", () => {
    const result = withExpoAssistant(baseConfig(), {}) as any;
    expect(result.mods?.ios?.infoPlist).toEqual(expect.any(Function));
    expect(result.mods?.ios?.entitlements).toEqual(expect.any(Function));
    expect(result.mods?.android?.manifest).toEqual(expect.any(Function));
  });

  it("preserves the original ExpoConfig identity fields", () => {
    const result = withExpoAssistant(baseConfig(), {}) as any;
    expect(result.name).toBe("test-app");
    expect(result.ios.bundleIdentifier).toBe("com.test.app");
    expect(result.android.package).toBe("com.test.app");
  });

  it("handles configs without ios/android stanzas", () => {
    const minimal = {
      name: "test-app",
      slug: "test-app",
      version: "1.0.0",
      _internal: { projectRoot: "/tmp/expo-assistant-test" },
    } as unknown as ExpoConfig;
    const result = withExpoAssistant(minimal, {
      intents: [IntentCategory.SEARCH],
    }) as any;
    expect(result.mods?.ios?.infoPlist).toEqual(expect.any(Function));
    expect(result.mods?.android?.manifest).toEqual(expect.any(Function));
  });

  it("logs the configuration when debugMode is true", () => {
    const spy = jest.spyOn(console, "log").mockImplementation();
    withExpoAssistant(baseConfig(), { debugMode: true });
    expect(spy).toHaveBeenCalledWith(
      "[expo-assistant] Plugin configuration:",
      expect.any(String)
    );
    spy.mockRestore();
  });
});

describe("withExpoAssistant — iOS AppShortcuts codegen", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "expo-assistant-test-"));
    fs.mkdirSync(path.join(tmpRoot, "test-app"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const readGenerated = () =>
    fs.readFileSync(
      path.join(tmpRoot, "test-app", "AppShortcutsBridge.generated.swift"),
      "utf8"
    );

  it("always writes AppShortcutsBridge.generated.swift even when no shortcuts are declared", async () => {
    await applyPlugin(baseConfig(), {}).runIosAppShortcutsCodegen(tmpRoot);
    const swift = readGenerated();
    expect(swift).toContain(
      "public struct ExpoAssistantAppShortcuts: AppShortcutsProvider"
    );
    expect(swift).toContain("return [AppShortcut]()");
  });

  it("emits one AppShortcut per ios.appShortcuts entry", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "search",
            title: "Search",
            phrases: ["Search for tacos in ${applicationName}"],
            systemImageName: "magnifyingglass",
          },
          {
            id: "play-music",
            title: "Play Music",
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain('GenericVoiceIntent(intentId: "search")');
    // Placeholder must be emitted as raw Swift interpolation — NOT escaped.
    expect(swift).toContain(
      'phrases: ["Search for tacos in \\(.applicationName)"]'
    );
    expect(swift).toContain('shortTitle: "Search"');
    expect(swift).toContain('systemImageName: "magnifyingglass"');

    expect(swift).toContain('GenericVoiceIntent(intentId: "play-music")');
    expect(swift).toContain('shortTitle: "Play Music"');
    // Default phrase when none specified is just the app name.
    expect(swift).toContain('phrases: ["\\(.applicationName)"]');
    // Default systemImageName is "mic" when not specified.
    expect(swift).toContain('systemImageName: "mic"');
  });

  it("escapes quotes and backslashes in shortcut titles and phrases", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "weird",
            title: 'Title with "quotes" and \\slashes',
            phrases: ['Phrase "with quotes" in ${applicationName}'],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain('shortTitle: "Title with \\"quotes\\" and \\\\slashes"');
    expect(swift).toContain(
      'phrases: ["Phrase \\"with quotes\\" in \\(.applicationName)"]'
    );
  });

  it("rejects ${query} (and any primitive slot) with a clear error pointing at #37", async () => {
    // Apple's AppShortcutPhrase only accepts AppEntity / AppEnum as voice
    // slots; primitives are silently dropped by linkd. We surface this at
    // prebuild instead of letting linkd drop the phrase at install time.
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search",
              title: "Search",
              phrases: ["Search ${applicationName} for ${query}"],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(
      /undeclared parameter[\s\S]+voice slots only work for AppEnum \/ AppEntity/
    );
  });

  it("rejects AppShortcut phrases missing the ${applicationName} token", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "bad",
              title: "Bad",
              phrases: ["Search for tacos"],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/must contain "\$\{applicationName\}"/);
  });

  // ── Typed multi-parameter intents (#25) ──────────────────────────────

  it("generates a dedicated typed AppIntent struct per shortcut with declared parameters", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "create-event",
            title: "Create Event",
            phrases: ["Create event in ${applicationName}"],
            parameters: [
              {
                name: "title",
                type: "string",
                title: "Title",
                prompt: "What is the event called?",
              },
              {
                name: "when",
                type: "string",
                title: "When",
                prompt: "When?",
              },
            ],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();

    // A typed struct is emitted with PascalCase-derived name.
    expect(swift).toContain(
      "public struct CreateEventIntent: AppIntent"
    );

    // Each declared parameter becomes an @Parameter with title +
    // requestValueDialog.
    expect(swift).toContain('title: "Title"');
    expect(swift).toContain(
      'requestValueDialog: "What is the event called?"'
    );
    expect(swift).toContain("public var title: String");
    expect(swift).toContain('title: "When"');
    expect(swift).toContain('requestValueDialog: "When?"');
    expect(swift).toContain("public var when: String");

    // parameterSummary references every declared parameter so iOS's
    // needs-value flow walks the user through each unbound value.
    expect(swift).toContain(
      'Summary("Create Event \\(\\.$title) \\(\\.$when)")'
    );

    // perform() marshals the full dict back through emitIntent.
    expect(swift).toContain('id: "create-event"');
    expect(swift).toContain('"title": title');
    expect(swift).toContain('"when": when');

    // AppShortcut binds the new typed intent (no GenericVoiceIntent here).
    expect(swift).toContain("intent: CreateEventIntent()");
    expect(swift).not.toContain(
      'GenericVoiceIntent(intentId: "create-event")'
    );
  });

  it("falls back to GenericVoiceIntent for shortcuts without declared parameters", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "legacy",
            title: "Legacy",
            phrases: ["Run legacy in ${applicationName}"],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain('GenericVoiceIntent(intentId: "legacy")');
    // No typed struct generated when no parameters declared.
    expect(swift).not.toContain("public struct LegacyIntent: AppIntent");
  });

  it("emits typed and legacy shortcuts side by side", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "legacy",
            title: "Legacy",
            phrases: ["Run legacy in ${applicationName}"],
          },
          {
            id: "typed",
            title: "Typed",
            phrases: ["Run typed in ${applicationName}"],
            parameters: [{ name: "amount", type: "number" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain('GenericVoiceIntent(intentId: "legacy")');
    expect(swift).toContain("intent: TypedIntent()");
    expect(swift).toContain("public struct TypedIntent: AppIntent");
    expect(swift).toContain("public var amount: Double");
  });

  it("maps parameter types to Swift primitives correctly", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "mixed",
            title: "Mixed",
            phrases: ["Mixed in ${applicationName}"],
            parameters: [
              { name: "label", type: "string" },
              { name: "count", type: "number" },
              { name: "active", type: "boolean" },
            ],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain("public var label: String");
    expect(swift).toContain("public var count: Double");
    expect(swift).toContain("public var active: Bool");
  });

  it("derives the Swift struct name from various id casings", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "kebab-case-id",
            title: "K",
            parameters: [{ name: "x", type: "string" }],
          },
          {
            id: "snake_case_id",
            title: "S",
            parameters: [{ name: "x", type: "string" }],
          },
          {
            id: "camelCaseId",
            title: "C",
            parameters: [{ name: "x", type: "string" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain("public struct KebabCaseIdIntent: AppIntent");
    expect(swift).toContain("public struct SnakeCaseIdIntent: AppIntent");
    expect(swift).toContain("public struct CamelCaseIdIntent: AppIntent");
  });

  it("rejects ${name} slots that reference declared primitive params (per #37)", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "create-event",
              title: "Create Event",
              phrases: [
                "Create event ${title} in ${applicationName}",
              ],
              parameters: [{ name: "title", type: "string" }],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(
      /is type "string"[\s\S]+AppShortcutPhrase only accepts AppEntity \/ AppEnum/
    );
  });

  it("uses prompt-free @Parameter when prompt is omitted", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "no-prompt",
            title: "NP",
            parameters: [{ name: "x", type: "string", title: "X" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain('title: "X"');
    expect(swift).not.toContain("requestValueDialog:");
  });

  it("defaults @Parameter title to the capitalized parameter name when title is omitted", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "default-title",
            title: "DT",
            parameters: [{ name: "amount", type: "number" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain('title: "Amount"');
  });

  // ── Rich primitive types (#29) ───────────────────────────────────────

  it("maps `date` parameter to Swift Date and marshals via ISO8601 formatter", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "scheduled",
            title: "Scheduled",
            parameters: [{ name: "when", type: "date" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain("public var when: Date");
    expect(swift).toContain(
      '"when": _expoAssistantISO8601Formatter.string(from: when)'
    );
    // Helper formatter must be emitted exactly once when any Date param exists.
    expect(swift).toContain("fileprivate let _expoAssistantISO8601Formatter");
    expect(swift).toContain("import Foundation");
  });

  it("maps `duration` and `length` to Measurement and marshals as {value, unit}", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "measured",
            title: "Measured",
            parameters: [
              { name: "duration", type: "duration" },
              { name: "distance", type: "length" },
            ],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain("public var duration: Measurement<UnitDuration>");
    expect(swift).toContain("public var distance: Measurement<UnitLength>");
    expect(swift).toContain(
      '"duration": ["value": duration.value, "unit": duration.unit.symbol] as [String: Any]'
    );
    expect(swift).toContain(
      '"distance": ["value": distance.value, "unit": distance.unit.symbol] as [String: Any]'
    );
  });

  it("maps `url` parameter to Swift URL and marshals as absoluteString", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "openurl",
            title: "Open URL",
            parameters: [{ name: "link", type: "url" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain("public var link: URL");
    expect(swift).toContain('"link": link.absoluteString');
  });

  it("omits the ISO8601 formatter when no Date parameters are declared", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "no-date",
            title: "ND",
            parameters: [{ name: "x", type: "string" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).not.toContain("_expoAssistantISO8601Formatter");
  });

  // ── AppEnum support (#29) ────────────────────────────────────────────

  it("generates an AppEnum-conforming Swift enum for each declared enum", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        enums: [
          {
            name: "WorkoutType",
            displayName: "Workout Type",
            cases: [
              { id: "running", display: "Running" },
              { id: "cycling", display: "Cycling" },
              { id: "swimming", display: "Swimming" },
            ],
          },
        ],
        appShortcuts: [
          {
            id: "start-workout",
            title: "Start Workout",
            parameters: [{ name: "kind", type: "enum:WorkoutType" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain(
      "public enum WorkoutType: String, AppEnum"
    );
    expect(swift).toContain("case running");
    expect(swift).toContain("case cycling");
    expect(swift).toContain("case swimming");
    expect(swift).toContain(
      'public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Workout Type"'
    );
    expect(swift).toContain('.running: "Running"');
    expect(swift).toContain('.cycling: "Cycling"');
    expect(swift).toContain('.swimming: "Swimming"');

    // Typed intent declares the parameter with the enum's Swift type
    // and marshals via .rawValue.
    expect(swift).toContain("public var kind: WorkoutType");
    expect(swift).toContain('"kind": kind.rawValue');
  });

  it("allows ${enumParam} slots in phrases and emits raw Swift interpolation (the #37 unlock for enum-typed params)", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        enums: [
          {
            name: "WorkoutType",
            cases: [
              { id: "running", display: "Running" },
              { id: "cycling", display: "Cycling" },
            ],
          },
        ],
        appShortcuts: [
          {
            id: "start-workout",
            title: "Start Workout",
            phrases: ["Start ${kind} workout in ${applicationName}"],
            parameters: [{ name: "kind", type: "enum:WorkoutType" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain(
      'phrases: ["Start \\(\\.$kind) workout in \\(.applicationName)"]'
    );
  });

  it("throws when enum:Name references an undeclared enum", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          enums: [
            { name: "Mode", cases: [{ id: "a", display: "A" }] },
          ],
          appShortcuts: [
            {
              id: "x",
              title: "X",
              parameters: [{ name: "k", type: "enum:Unknown" }],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/references enum "Unknown" which is not declared/);
  });

  it("rejects enum declarations with invalid Swift identifiers", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          enums: [
            { name: "1Bad", cases: [{ id: "a", display: "A" }] },
          ],
          appShortcuts: [],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/not a valid Swift identifier/);
  });

  it("rejects enum cases with invalid Swift identifiers", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          enums: [
            {
              name: "Mode",
              cases: [{ id: "bad case", display: "Bad" }],
            },
          ],
          appShortcuts: [],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/case id "bad case" is not a valid Swift identifier/);
  });

  it("rejects enums declared with zero cases", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          enums: [{ name: "Empty", cases: [] }],
          appShortcuts: [],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/must declare at least one case/);
  });

  it("includes Apple framework reference URLs in the generated file header, conditionally", async () => {
    // Minimal shortcut: only the base AppShortcut/Provider/Intent docs
    // should appear — no enum / date / measurement / URL lines.
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "min",
            title: "Min",
            phrases: ["Run in ${applicationName}"],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    let swift = readGenerated();
    expect(swift).toContain(
      "AppShortcutsProvider — https://developer.apple.com/documentation/appintents/appshortcutsprovider"
    );
    expect(swift).toContain(
      "AppShortcut          — https://developer.apple.com/documentation/appintents/appshortcut"
    );
    // Type-specific doc URLs should NOT be listed when the corresponding
    // feature isn't used. We assert against the URLs (not the bare type
    // names, which can appear in surrounding prose comments).
    expect(swift).not.toContain("documentation/appintents/appenum");
    expect(swift).not.toContain("documentation/foundation/iso8601dateformatter");
    expect(swift).not.toContain("documentation/foundation/measurement");
    expect(swift).not.toContain("documentation/foundation/url");

    // Rich app: enum + date + measurement + url + typed intent → every
    // applicable doc URL should be listed.
    await applyPlugin(baseConfig(), {
      ios: {
        enums: [
          { name: "Mode", cases: [{ id: "a", display: "A" }] },
        ],
        appShortcuts: [
          {
            id: "rich",
            title: "Rich",
            phrases: ["Run in ${applicationName}"],
            parameters: [
              { name: "kind", type: "enum:Mode" },
              { name: "when", type: "date" },
              { name: "len", type: "length" },
              { name: "link", type: "url" },
            ],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    swift = readGenerated();
    expect(swift).toContain(
      "@Parameter           — https://developer.apple.com/documentation/appintents/parameter"
    );
    expect(swift).toContain(
      "AppEnum              — https://developer.apple.com/documentation/appintents/appenum"
    );
    expect(swift).toContain(
      "ISO8601DateFormatter — https://developer.apple.com/documentation/foundation/iso8601dateformatter"
    );
    expect(swift).toContain(
      "Measurement          — https://developer.apple.com/documentation/foundation/measurement"
    );
    expect(swift).toContain(
      "URL                  — https://developer.apple.com/documentation/foundation/url"
    );
  });

  it("still rejects ${rich-primitive-param} slots in phrases (date is not slottable)", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "scheduled",
              title: "Scheduled",
              phrases: ["Schedule for ${when} in ${applicationName}"],
              parameters: [{ name: "when", type: "date" }],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/is type "date"[\s\S]+only accepts AppEntity \/ AppEnum/);
  });

  // ── AppEntity support (#28) ──────────────────────────────────────────

  it("generates an AppEntity + EntityStringQuery Swift pair for each declared entity", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        entities: [
          {
            name: "Project",
            displayName: "Project",
            properties: [
              { name: "title", type: "string" },
              { name: "priority", type: "number" },
            ],
          },
        ],
        appShortcuts: [
          {
            id: "open-project",
            title: "Open Project",
            parameters: [{ name: "project", type: "entity:Project" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();

    // Entity struct: AppEntity conformance + Identifiable + properties
    expect(swift).toContain(
      "public struct ProjectEntity: AppEntity, IndexedEntity, Identifiable"
    );
    expect(swift).toContain("public let id: String");
    expect(swift).toContain('@Property(title: "Title")\n    public var title: String');
    expect(swift).toContain('@Property(title: "Priority")\n    public var priority: Double');
    expect(swift).toContain(
      'public static var typeDisplayRepresentation: TypeDisplayRepresentation = "Project"'
    );
    expect(swift).toContain("public static var defaultQuery = ProjectQuery()");

    // displayRepresentation pulls the title property by default
    expect(swift).toContain('DisplayRepresentation(title: "\\(title)")');

    // init(from dict:) — reads each declared property
    expect(swift).toContain(
      '(dict["title"] as? String) ?? ""'
    );
    expect(swift).toContain(
      '(dict["priority"] as? Double) ?? 0'
    );

    // asDictionary() marshals back to JS
    expect(swift).toContain('"id": id');
    expect(swift).toContain('"title": title');
    expect(swift).toContain('"priority": priority');

    // EntityStringQuery proxies all three required methods through the
    // pod's EntityResolver bridge.
    expect(swift).toContain(
      "public struct ProjectQuery: EntityStringQuery"
    );
    expect(swift).toContain(
      'ExpoAssistantModule.shared?.entityResolver.resolve(\n            typeName: "Project",\n            kind: "matching"'
    );
    expect(swift).toContain('kind: "for"');
    expect(swift).toContain('kind: "suggested"');

    // Typed intent declares the param with the generated entity type.
    expect(swift).toContain("public var project: ProjectEntity");
    expect(swift).toContain('"project": project.asDictionary()');
  });

  it("allows ${entityParam} slots in phrases and emits raw Swift interpolation", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        entities: [
          {
            name: "Project",
            properties: [{ name: "title", type: "string" }],
          },
        ],
        appShortcuts: [
          {
            id: "open-project",
            title: "Open Project",
            phrases: ["Open ${project} in ${applicationName}"],
            parameters: [{ name: "project", type: "entity:Project" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain(
      'phrases: ["Open \\(\\.$project) in \\(.applicationName)"]'
    );
  });

  it("throws when entity:Name references an undeclared entity", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          entities: [
            {
              name: "Project",
              properties: [{ name: "title", type: "string" }],
            },
          ],
          appShortcuts: [
            {
              id: "x",
              title: "X",
              parameters: [{ name: "ref", type: "entity:Unknown" }],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/references entity "Unknown" which is not declared/);
  });

  it("rejects entity declarations with invalid Swift identifiers", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          entities: [
            {
              name: "1Bad",
              properties: [{ name: "title", type: "string" }],
            },
          ],
          appShortcuts: [],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/entity name "1Bad" is not a valid Swift identifier/);
  });

  it("rejects entity properties with invalid Swift identifiers", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          entities: [
            {
              name: "Project",
              properties: [{ name: "bad name", type: "string" }],
            },
          ],
          appShortcuts: [],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/property "bad name" is not a valid Swift identifier/);
  });

  it("rejects entities declared with zero properties", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          entities: [{ name: "Empty", properties: [] }],
          appShortcuts: [],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(/must declare at least one property/);
  });

  it("rejects entities with no string property usable for DisplayRepresentation when displayProperty is omitted", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          entities: [
            {
              name: "Numeric",
              properties: [{ name: "count", type: "number" }],
            },
          ],
          appShortcuts: [],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(
      /must declare at least one string property OR specify displayProperty/
    );
  });

  it("rejects displayProperty that references a non-string property", async () => {
    await expect(
      applyPlugin(baseConfig(), {
        ios: {
          entities: [
            {
              name: "Mismatched",
              displayProperty: "rank",
              properties: [
                { name: "name", type: "string" },
                { name: "rank", type: "number" },
              ],
            },
          ],
          appShortcuts: [],
        },
      }).runIosAppShortcutsCodegen(tmpRoot)
    ).rejects.toThrow(
      /displayProperty "rank" must reference a string property/
    );
  });

  it("honors an explicit displayProperty over the default 'title' / first-string heuristic", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        entities: [
          {
            name: "Project",
            displayProperty: "name",
            properties: [
              { name: "name", type: "string" },
              { name: "title", type: "string" },
            ],
          },
        ],
        appShortcuts: [
          {
            id: "x",
            title: "X",
            parameters: [{ name: "p", type: "entity:Project" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain('DisplayRepresentation(title: "\\(name)")');
  });

  it("emits AppEntity / EntityStringQuery Apple-doc URLs only when entities are declared", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        entities: [
          {
            name: "Project",
            properties: [{ name: "title", type: "string" }],
          },
        ],
        appShortcuts: [
          {
            id: "x",
            title: "X",
            parameters: [{ name: "p", type: "entity:Project" }],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    expect(swift).toContain(
      "AppEntity            — https://developer.apple.com/documentation/appintents/appentity"
    );
    expect(swift).toContain(
      "EntityStringQuery    — https://developer.apple.com/documentation/appintents/entitystringquery"
    );
  });
});

describe("withExpoAssistant — AssistantSchemas codegen (#30)", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "expo-assistant-test-"));
    fs.mkdirSync(path.join(tmpRoot, "test-app"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const readGenerated = () =>
    fs.readFileSync(
      path.join(tmpRoot, "test-app", "AppShortcutsBridge.generated.swift"),
      "utf8"
    );

  describe("system.search schema (full first cut)", () => {
    it("emits @AppIntent(schema: .system.search) macro and ShowInAppSearchResultsIntent conformance", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
              phrases: ["Search ${applicationName}"],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      expect(swift).toContain("@AppIntent(schema: .system.search)");
      expect(swift).toContain(
        "public struct SearchProductsIntent: ShowInAppSearchResultsIntent"
      );
    });

    it("wraps schema struct with @available(iOS 18.0, *)", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      // The @available attribute must precede the macro + struct.
      expect(swift).toMatch(
        /@available\(iOS 18\.0, \*\)\s*\n@AppIntent\(schema: \.system\.search\)/
      );
    });

    it("OMITS static var title and description on schema-bound structs (schema OWNS them)", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      // The body of SearchProductsIntent should NOT contain `static var title`
      // or `static var description`. Scope the check to the struct body.
      const structMatch = swift.match(
        /public struct SearchProductsIntent[^{]*\{([\s\S]*?)\n\}/
      );
      expect(structMatch).not.toBeNull();
      const structBody = structMatch![1];
      expect(structBody).not.toContain("static var title");
      expect(structBody).not.toContain("static var description");
    });

    it("auto-injects the required `criteria: StringSearchCriteria` parameter from the catalog", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
              // Developer doesn't declare criteria — the catalog supplies it.
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      // Schema-required parameters are bare `var` declarations because
      // the @AppIntent(schema:) macro applies @Parameter automatically.
      expect(swift).toContain("public var criteria: StringSearchCriteria");
      // And NOT wrapped with our @Parameter helper (which would conflict).
      const structMatch = swift.match(
        /public struct SearchProductsIntent[^{]*\{([\s\S]*?)\n\}/
      );
      expect(structMatch).not.toBeNull();
      const structBody = structMatch![1];
      expect(structBody).not.toMatch(/@Parameter[\s\S]*?criteria/);
    });

    it("emits the catalog's static declarations (searchScopes for system.search)", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      expect(swift).toContain(
        "public static var searchScopes: [StringSearchScope] = [.general]"
      );
    });

    it("emits isAssistantOnly = true when assistantOnly is set", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
              assistantOnly: true,
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      expect(swift).toContain("public static let isAssistantOnly: Bool = true");
    });

    it("does NOT emit isAssistantOnly when not set", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      expect(swift).not.toContain("isAssistantOnly");
    });

    it("marshals StringSearchCriteria via .term when bridging to JS", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      // criteria.term unwraps the StringSearchCriteria → String for JS.
      expect(swift).toContain('"criteria": criteria.term');
    });

    it("accepts extra developer-defined parameters beyond the schema's required set", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
              parameters: [
                { name: "limit", type: "number", title: "Limit" },
              ],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      // Required param still emitted from catalog.
      expect(swift).toContain("public var criteria: StringSearchCriteria");
      // Extra param wrapped with our @Parameter helper.
      expect(swift).toMatch(/@Parameter[\s\S]*?title: "Limit"[\s\S]*?public var limit: Double/);
      // Both marshaled into the bridge payload.
      expect(swift).toContain('"criteria": criteria.term');
      expect(swift).toContain('"limit": limit');
    });
  });

  describe("AppShortcutsProvider integration", () => {
    it("wraps schema-bound AppShortcut entries inside #available(iOS 18.0, *)", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "open-thing",
              title: "Open Thing",
              // No schema — should stay outside the iOS 18 guard.
            },
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      // Mixed pattern: var shortcuts = [...]; if #available { append }
      expect(swift).toContain("var shortcuts: [AppShortcut] =");
      expect(swift).toContain("if #available(iOS 18.0, *) {");
      // Non-schema entry in the base array.
      expect(swift).toMatch(
        /var shortcuts: \[AppShortcut\] = \[[\s\S]*?intentId: "open-thing"/
      );
      // Schema entry inside the conditional append block.
      expect(swift).toMatch(
        /if #available\(iOS 18\.0, \*\)[\s\S]*?SearchProductsIntent\(\)/
      );
    });

    it("uses the conditional pattern even when only schema-bound shortcuts are declared", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      expect(swift).toContain("var shortcuts: [AppShortcut] = []");
      expect(swift).toContain("if #available(iOS 18.0, *) {");
      expect(swift).toContain("return shortcuts");
    });

    it("uses the plain return pattern when no schema-bound shortcuts are declared", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "open-thing",
              title: "Open Thing",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      // No conditional, no var pattern.
      expect(swift).not.toContain("if #available(iOS 18.0, *)");
      expect(swift).not.toContain("var shortcuts:");
      expect(swift).toContain("return [");
    });

    it("includes AssistantSchemas docs in the Apple-ref header when schema intents are present", async () => {
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);

      const swift = readGenerated();
      expect(swift).toContain(
        "AssistantSchemas     — https://developer.apple.com/documentation/appintents/assistantschemas"
      );
      expect(swift).toContain(
        "@AppIntent(schema:)  — https://developer.apple.com/documentation/appintents/appintent(schema:)"
      );
    });
  });

  describe("validation", () => {
    it("throws when a shortcut declares an unknown schema id", async () => {
      await expect(
        applyPlugin(baseConfig(), {
          ios: {
            appShortcuts: [
              {
                id: "bogus",
                title: "Bogus",
                schema: "system.bogus",
              },
            ],
          },
        }).runIosAppShortcutsCodegen(tmpRoot)
      ).rejects.toThrow(/not in the AssistantSchemas catalog/);
    });

    it("error message for unknown schema lists known schema ids", async () => {
      await expect(
        applyPlugin(baseConfig(), {
          ios: {
            appShortcuts: [
              {
                id: "bogus",
                title: "Bogus",
                schema: "system.bogus",
              },
            ],
          },
        }).runIosAppShortcutsCodegen(tmpRoot)
      ).rejects.toThrow(/system\.search/);
    });

    it("throws on duplicate schema across shortcuts (per-schema-id uniqueness — spike finding H)", async () => {
      await expect(
        applyPlugin(baseConfig(), {
          ios: {
            appShortcuts: [
              {
                id: "search-one",
                title: "Search One",
                schema: "system.search",
              },
              {
                id: "search-two",
                title: "Search Two",
                schema: "system.search",
              },
            ],
          },
        }).runIosAppShortcutsCodegen(tmpRoot)
      ).rejects.toThrow(
        /Schema "system\.search" declared on multiple shortcuts/
      );
    });

    it("throws when developer redeclares a schema-required parameter", async () => {
      await expect(
        applyPlugin(baseConfig(), {
          ios: {
            appShortcuts: [
              {
                id: "search-products",
                title: "Search Products",
                schema: "system.search",
                parameters: [
                  // criteria is auto-injected by system.search — declaring
                  // it again here is a conflict.
                  { name: "criteria", type: "string" },
                ],
              },
            ],
          },
        }).runIosAppShortcutsCodegen(tmpRoot)
      ).rejects.toThrow(/auto-injected by the schema/);
    });

    it("allows extra developer parameters that don't collide with schema-required ones", async () => {
      // This should succeed — `limit` is not a schema-required name for
      // system.search.
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            {
              id: "search-products",
              title: "Search Products",
              schema: "system.search",
              parameters: [{ name: "limit", type: "number" }],
            },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);
      // No throw == pass.
    });

    it("does not interfere with non-schema shortcuts", async () => {
      // Shortcuts without `schema` should continue to work exactly as
      // they did pre-#30.
      await applyPlugin(baseConfig(), {
        ios: {
          appShortcuts: [
            { id: "open-thing", title: "Open Thing" },
          ],
        },
      }).runIosAppShortcutsCodegen(tmpRoot);
      const swift = readGenerated();
      expect(swift).toContain('GenericVoiceIntent(intentId: "open-thing")');
      expect(swift).not.toContain("@AppIntent(schema:");
    });
  });
});
