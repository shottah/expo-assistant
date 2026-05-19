# Runbook: Integrate a voice-triggered AppShortcut (iOS)

End-to-end guide for adding a voice shortcut to your Expo app via `expo-assistant`. The shortcut is a **custom `AppIntent`** exposed through the package's generated `AppShortcutsProvider`. iOS-verified. Android uses a different surface and isn't covered here.

## Prerequisites

- Expo SDK 54+, iOS deployment target 16.0+
- `expo.ios.bundleIdentifier` set in `app.json`

## 1. Install + configure

```bash
bun add expo-assistant
```

```json
{
  "expo": {
    "ios": { "bundleIdentifier": "com.example.myapp" },
    "plugins": [
      ["expo-assistant", {
        "intents": ["search", "productivity"],
        "ios": {
          "siriUsageDescription": "Search, capture, and schedule via voice",
          "appShortcuts": [
            {
              "id": "search",
              "title": "Search MyApp",
              "systemImageName": "magnifyingglass",
              "phrases": [
                "Search in ${applicationName}",
                "Search ${applicationName}"
              ]
            },
            {
              "id": "create-event",
              "title": "Create Event",
              "systemImageName": "calendar.badge.plus",
              "phrases": [
                "Create event in ${applicationName}",
                "Use ${applicationName} to create an event"
              ]
            },
            {
              "id": "quick-note",
              "title": "Quick Note",
              "systemImageName": "square.and.pencil",
              "phrases": [
                "Add note to ${applicationName}",
                "Quick note in ${applicationName}"
              ]
            }
          ]
        }
      }]
    ]
  }
}
```

Three shortcuts side-by-side — one search, one capture, one scheduling intent. Each gets its own tile in Shortcuts.app Library / Spotlight, prompts the user for their query at tap time, and routes to a per-`id` JS handler. Mirrors what the `example/` app in this repo ships.

### Configuration reference

#### Top-level plugin options

| Field | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `intents` | `IntentCategory[]` | no | `[]` | Hints which intent families your app supports. Drives legacy SiriKit `NSUserActivityTypes` injection. Allowed: `"search" \| "media" \| "productivity" \| "health" \| "communication" \| "travel" \| "finance" \| "commerce" \| "custom"`. |
| `debugMode` | `boolean` | no | `false` | If `true`, plugin logs each mod step during prebuild. Useful when debugging codegen. |
| `enableSiriKit` | `boolean` | no | `true` | When `true`, adds the `com.apple.developer.siri` entitlement. Set `false` to skip Siri integration entirely. |
| `enableBackgroundExecution` | `boolean` | no | `false` | Adds `audio` + `processing` to `UIBackgroundModes` for intents that need to run while backgrounded. |
| `enableHealthKit` | `boolean` | no | `false` | Adds HealthKit entitlements + usage descriptions. Only set if you handle health intents. |
| `enableMediaSession` | `boolean` | no | `false` | Adds playable-content entitlement + audio background mode for media playback intents. |
| `ios` | `object` | no | `{}` | iOS-specific config — see next table. |
| `android` | `object` | no | `{}` | Android-specific config (out of scope here). |

#### `ios` options

| Field | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `siriUsageDescription` | `string` | recommended | `"This app uses Siri for voice assistant features"` | `NSSiriUsageDescription` shown when iOS asks the user to enable Siri for your app. Be specific — Apple rejects generic strings. |
| `alternativeAppNames` | `string[]` | no | `undefined` | Aliases iOS accepts in the `${applicationName}` slot. Use for short forms or pronunciations (e.g. `["MA", "My App"]`). Each adds an `INAlternativeAppName` plist entry. |
| `appShortcuts` | `AppShortcut[]` | no | `[]` | Voice-triggered shortcuts that appear in Shortcuts.app / Spotlight / Siri. See next table. **Up to ~10 per app** (Apple limit). |
| `appGroups` | `string[]` | no | `undefined` | App Groups for sharing data with an Intent Extension. Auto-populated when `intentExtensionBundleId` is set. |
| `siriKitDomains` | `string[]` | no | `undefined` | Sets `NSSiriKitDomains` — declares which legacy SiriKit domains your app participates in. |
| `intentExtensionBundleId` | `string` | no | `undefined` | If set, the plugin scaffolds a legacy Intent Extension (pre-iOS 16 path). Most apps should leave this unset and rely on `appShortcuts`. |
| `supportedIntentTypes` | `string[]` | no | `undefined` | Extra legacy `INIntent` class names to add to `NSUserActivityTypes`. |
| `requiresUnlock` | `boolean` | no | `true` | If `true`, sensitive intents (payments, money transfer) require device unlock. |

#### `appShortcuts[]` entry

| Field | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `id` | `string` | **yes** | — | Routing key. Must equal the JS `withId(...)` value exactly (case-sensitive). Keep it `kebab-case` or `snake_case` to avoid Siri-rendered casing surprises. |
| `title` | `string` | **yes** | — | Display label in Shortcuts.app Library, Spotlight, and the long-press app-icon menu. Short — 2-3 words ideal. |
| `phrases` | `string[]` | recommended | `["${applicationName}"]` | Voice templates. Every entry **must** contain `${applicationName}`. May contain `${query}` to bind the spoken query into the handler. Declare 3-5 variants. If omitted, only the bare app-name phrase is available. |
| `systemImageName` | `string` | no | `"mic"` | SF Symbol name for the shortcut tile icon. Must match an existing SF Symbol (e.g. `"magnifyingglass"`, `"plus.circle"`, `"music.note"`). |

#### Phrase template tokens

| Token | Resolves to | Required in every phrase? |
|---|---|---|
| `${applicationName}` | Your app name (or any `alternativeAppNames` alias) | **yes** — iOS silently drops phrases without it |
| `${query}` | Spoken query slot → bound to handler's `query` param | no — but if absent, iOS will prompt at runtime (query is required) |

**Phrase rules — non-negotiable:**

1. Every phrase **must** include `${applicationName}` somewhere. iOS silently drops phrases without it; the plugin throws at prebuild.
2. **`${query}` slot does NOT work today.** The plugin still accepts it for forward-compatibility, but `linkd` rejects phrases containing it with `Skipping phrase template with an unrecognized token`, and the affected phrases never surface in Spotlight or voice. **Use bare phrases without `${query}` and rely on the prompt path instead** — the package's `query` parameter is required, so tapping the shortcut from Library / Spotlight triggers `requestValueDialog` and prompts the user for input. Tracked in #37.
3. Declare 3–5 phrase variants per shortcut covering preposition swaps (`in`/`with`/`on`) and verb synonyms (`Search`/`Find`/`Look up`). iOS does not auto-synonymize connectors.
4. Want a shorter spoken form? Add `ios.alternativeAppNames: ["MA", ...]` — iOS accepts any alias in the `${applicationName}` slot.

## 2. Prebuild

```bash
bunx expo prebuild --platform ios
```

Generates `ios/<YourApp>/AppShortcutsBridge.generated.swift` and registers it in the Xcode pbxproj's Compile Sources phase.

## 3. Register JS handlers

Register one handler per shortcut id you declared. Each receives the query string the user entered at the prompt and returns whatever your business logic produces:

```ts
import { VoiceAssistant, VoiceIntentBuilder, IntentCategory, ParameterType } from 'expo-assistant';

const va = await VoiceAssistant.initialize({ debugMode: true });

const stringParam = (b: ReturnType<typeof VoiceIntentBuilder.create>) =>
  b.requiredParameter('query', { type: ParameterType.STRING });

await va.registerIntent(
  stringParam(VoiceIntentBuilder.create<{ query: string }>().withId('search'))
    .withCategory(IntentCategory.SEARCH)
    .withHandler({
      handle: async ({ query }) => ({ ok: true, hits: await doSearch(query) }),
    })
    .build()
);

await va.registerIntent(
  stringParam(VoiceIntentBuilder.create<{ query: string }>().withId('create-event'))
    .withCategory(IntentCategory.PRODUCTIVITY)
    .withHandler({
      handle: async ({ query }) => {
        // Phase 1: parse the single query string in JS (chrono-node,
        // your own parser, regex). Phase 2 (#25) will split title +
        // date into distinct AppShortcut parameters Siri extracts.
        const { title, when } = parseEventQuery(query);
        return { ok: true, scheduled: await scheduleEvent(title, when) };
      },
    })
    .build()
);

await va.registerIntent(
  stringParam(VoiceIntentBuilder.create<{ query: string }>().withId('quick-note'))
    .withCategory(IntentCategory.PRODUCTIVITY)
    .withHandler({
      handle: async ({ query }) => ({ ok: true, noteId: await appendNote(query) }),
    })
    .build()
);
```

**Critical:** `withId(...)` must equal the `id` field in `app.json` byte-for-byte. The JS dispatcher does a case-sensitive map lookup — `Search` ≠ `search`. Mismatch is silent (handler never fires).

## 4. Build + reinstall

```bash
bunx expo run:ios  # first time / cold start

# After app.json appShortcuts changes — MUST reinstall, not just relaunch.
# linkd only re-ingests metadata at install time.
xcrun simctl uninstall booted com.example.myapp
xcrun simctl install booted "/path/to/<YourApp>.app"
xcrun simctl launch booted com.example.myapp
```

## 5. Invocation paths

| Path | Trigger | Behavior |
|---|---|---|
| Siri voice (bare phrase) | "Search MyApp" | Prompts via `requestValueDialog`, then fires |
| Siri voice (with query slot) | "Search for *tacos* in MyApp" | **Does NOT work today** — see #37. Same prompt path as bare today. |
| Spotlight | swipe down, type phrase, tap tile | Prompts for query, fires handler |
| Shortcuts.app → Library | tap auto-listed tile under your app | Prompts for unbound required params, fires |
| Long-press app icon | suggested actions menu | Same as Library tap |

Handler runs in your app's process — Expo runtime is up, no cold-start penalty if foregrounded or recent.

## 6. Donate (optional)

```ts
await va.donateIntent('search', { query: 'tacos' });
```

Hints to iOS that the user just did this action. Does **not** invoke. Feeds Siri suggestions, Spotlight Recents, lock-screen surfacing. No immediate visible effect. Call from JS after a successful user action, not on registration.

## 7. Verify (in order, stop at first failure)

- [ ] App launches; status text shows `registered`
- [ ] `linkd` ingested metadata: `xcrun simctl spawn booted log show --predicate 'subsystem == "com.apple.appintents"' --last 1m | grep -i "your-bundle\|skipping phrase"` — expect `Found static metadata file`, no `Skipping phrase` errors
- [ ] Spotlight: shortcut tile appears with your icon (not Safari compass)
- [ ] Shortcuts.app → Library: your app section appears with the shortcut listed
- [ ] Tap from Library → "What would you like to search for?" prompt → enter value → handler fires, status updates

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Shortcut absent from Spotlight/Library | Phrase missing `${applicationName}` | Add token; plugin should throw at prebuild |
| `linkd` log: `Skipping phrase missing an ${applicationName} token` | Same | Same |
| Library tap fires immediately, handler gets `null` | `query` is optional in pod (forked or older version) | This package's `query` must be required |
| Tap does nothing in JS | `id` mismatch between `app.json` and `withId(...)` | Make them byte-for-byte equal |
| Generated swift on disk but not in binary | Plugin didn't register in pbxproj | Use plugin version with `withXcodeProject` + `addBuildSourceFileToGroup` |
| `app.json` changes don't take effect | Relaunched instead of reinstalled | `uninstall` + `install` — linkd only re-ingests at install |
| `No script URL provided` red screen | Metro not running | `bunx expo start` |

## 9. Inspect metadata (when stuck)

```bash
APP=/path/to/<YourApp>.app
python3 -c "
import json
d = json.load(open('$APP/Metadata.appintents/extract.actionsdata'))
print(json.dumps(d['actions']['GenericVoiceIntent'], indent=2))
print('---')
print(json.dumps(d.get('autoShortcuts', []), indent=2))
"
```

Key things to check:
- `parameters[query].isOptional: false` — required for prompts to work
- `actionConfiguration.actionSummary.summaryString.parameterIdentifiers` lists `query`
- `autoShortcuts[].phraseTemplates[].key` shows your `${applicationName}` / `${query}` tokens

## 10. Current limits

- **One free-form parameter per invocation.** All shortcuts route through a shared `GenericVoiceIntent` with a single `query: String` slot. Phrases like "Send `${amount}` to `${recipient}` in MyApp" are not expressible today — tracked in #25.
- **~10 AppShortcuts per app**, ~5–10 phrases per shortcut (Apple's practical budget).
- **No typed params, entities, enums, dialogs, or disambiguation flows** — see #19 and #25 for upgrade paths.
- **Simulator has no Siri voice.** Voice extraction can only be confirmed on a physical device.
