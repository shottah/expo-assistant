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
});
