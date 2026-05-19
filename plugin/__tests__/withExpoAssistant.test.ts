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

  it("translates ${query} into the raw Swift parameter interpolation", async () => {
    await applyPlugin(baseConfig(), {
      ios: {
        appShortcuts: [
          {
            id: "search",
            title: "Search",
            phrases: ["Search ${applicationName} for ${query}"],
          },
        ],
      },
    }).runIosAppShortcutsCodegen(tmpRoot);

    const swift = readGenerated();
    // Both tokens must emit as unescaped Swift interpolation.
    expect(swift).toContain(
      'phrases: ["Search \\(.applicationName) for \\(\\.$query)"]'
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
});
