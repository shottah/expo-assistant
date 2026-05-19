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
        "intents": ["productivity"],
        "ios": {
          "siriUsageDescription": "Schedule events via voice",
          "appShortcuts": [{
            "id": "create-event",
            "title": "Create Event",
            "systemImageName": "calendar.badge.plus",
            "phrases": [
              "Create event in ${applicationName}",
              "Use ${applicationName} to create an event"
            ],
            "parameters": [
              { "name": "title", "type": "string", "title": "Title", "prompt": "What's the event called?" },
              { "name": "when",  "type": "string", "title": "When",  "prompt": "When?" }
            ]
          }]
        }
      }]
    ]
  }
}
```

One shortcut, two required parameters. iOS prompts the user for each one in turn when they invoke the shortcut without bound values. The JS handler receives a typed dict `{ title, when }`.

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
| `phrases` | `string[]` | recommended | `["${applicationName}"]` | Voice templates. Every entry **must** contain `${applicationName}`. Plugin throws at prebuild on any `${paramName}` slot because Apple only accepts AppEntity / AppEnum types as voice slots, never primitives — see #37 + Phrase rules below. Declare 3-5 variants. |
| `systemImageName` | `string` | no | `"mic"` | SF Symbol name for the shortcut tile icon. Must match an existing SF Symbol (e.g. `"magnifyingglass"`, `"plus.circle"`, `"music.note"`). |
| `parameters` | `AppShortcutParameter[]` | no | `undefined` | Declares typed parameters for this shortcut. When present, the plugin generates a dedicated typed AppIntent Swift struct (named `<PascalCaseId>Intent`); iOS prompts the user for each unbound parameter via `requestValueDialog` at tap time. When omitted, the shortcut routes through the generic `GenericVoiceIntent` with a single required `query: String` (back-compat). See next table. |

#### `parameters[]` entry

| Field | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `name` | `string` | **yes** | — | Identifier. Becomes the Swift `@Parameter` property name AND the JS dict key the handler receives. Must be a valid identifier in both. |
| `type` | `"string" \| "number" \| "boolean"` | **yes** | — | Swift type emitted (`String`, `Double`, `Bool`). Rich types (Date, Measurement, URL, IntentFile) tracked in #29; entity/enum types in #28. |
| `title` | `string` | no | `name` capitalized | Display title used by `@Parameter(title:)`. |
| `prompt` | `string` | no | `undefined` | Text iOS speaks/shows when the parameter is unbound at invocation time. Becomes `requestValueDialog`. If omitted, iOS uses its default phrasing. |

#### Phrase template tokens

| Token | Resolves to | Required in every phrase? |
|---|---|---|
| `${applicationName}` | Your app name (or any `alternativeAppNames` alias) | **yes** — iOS silently drops phrases without it |
| `${paramName}` | Voice slot for a declared parameter | **not supported today** — Apple only accepts AppEntity / AppEnum types as phrase slots (#37). Plugin throws at prebuild. Use bare phrases + prompt path. |

**Phrase rules — non-negotiable:**

1. Every phrase **must** include `${applicationName}` somewhere. iOS silently drops phrases without it; the plugin throws at prebuild.
2. **No `${paramName}` slots today.** Apple's `AppShortcutPhrase` only accepts `AppEntity` or `AppEnum` types as voice slots ([DTS engineer ruling](https://developer.apple.com/forums/thread/770037)); primitives (string / number / boolean / date) are silently dropped by `linkd`. The plugin throws at prebuild rather than emit a phrase that won't work. Use bare phrases and rely on `requestValueDialog` prompts (declared via the parameter's `prompt` field). Voice-slot extraction unlocks once #28 (AppEntity) and #29 (AppEnum) land — tracked in #37.
3. Declare 3–5 phrase variants per shortcut covering preposition swaps (`in`/`with`/`on`) and verb synonyms (`Search`/`Find`/`Look up`). iOS does not auto-synonymize connectors.
4. Want a shorter spoken form? Add `ios.alternativeAppNames: ["MA", ...]` — iOS accepts any alias in the `${applicationName}` slot.

## 2. Prebuild

```bash
bunx expo prebuild --platform ios
```

Generates `ios/<YourApp>/AppShortcutsBridge.generated.swift` and registers it in the Xcode pbxproj's Compile Sources phase.

## 3. Register a JS handler

Register one `requiredParameter(...)` per parameter you declared in `app.json`. The handler receives a dict keyed by parameter name.

```ts
import { VoiceAssistant, VoiceIntentBuilder, IntentCategory, ParameterType } from 'expo-assistant';

const va = await VoiceAssistant.initialize({ debugMode: true });

await va.registerIntent(
  VoiceIntentBuilder.create<{ title: string; when: string }>()
    .withId('create-event')  // case-sensitive; must equal app.json `id` exactly
    .withCategory(IntentCategory.PRODUCTIVITY)
    .requiredParameter('title', { type: ParameterType.STRING })
    .requiredParameter('when',  { type: ParameterType.STRING })
    .withHandler({
      handle: async ({ title, when }) => ({
        ok: true,
        scheduled: await scheduleEvent(title, when),
      }),
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
| Siri voice | "Create event in MyApp" | Prompts via `requestValueDialog` for each unbound required parameter in turn, then fires |
| Spotlight | swipe down, type phrase, tap tile | Same as Library tap |
| Shortcuts.app → Library | tap auto-listed tile under your app | Prompts for unbound required params one at a time, then fires |
| Long-press app icon | suggested actions menu | Same as Library tap |

Note: voice-slot extraction (saying the parameter value as part of the phrase) is not supported today — see Phrase rules above and #37.

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
- For each declared parameter on a typed intent: `parameters[<name>].isOptional: false` — required for prompts to work
- For the legacy `GenericVoiceIntent` (back-compat path), `parameters[query].isOptional: false`
- `actionConfiguration.actionSummary.summaryString.parameterIdentifiers` lists every declared parameter
- `autoShortcuts[].phraseTemplates[].key` shows your phrases with the literal `${applicationName}` token

## 10. Current limits

- **No voice slots for parameters.** Apple only accepts `AppEntity` / `AppEnum` as `AppShortcutPhrase` slots; primitives (`string`, `number`, `boolean`, `Date`, etc.) are silently dropped by `linkd`. Users hit the prompt path instead. Tracked in #37 + unblocked by #28 (entities) / #29 (enums).
- **No rich primitive types yet** — only `string`, `number`, `boolean` parameters today. Date, Measurement, URL, IntentFile in #29.
- **No entities** — no autocomplete or disambiguation against app data. #28.
- **No Apple Intelligence schema conformance** — custom AppIntent only. #30 (blocked on #35 research).
- **No result presentation surfaces** — no `ProvidesDialog` / `ShowsSnippetView` / `OpensIntent` / `ReturnsValue`. #31.
- **~10 AppShortcuts per app**, ~5–10 phrases per shortcut (Apple's practical budget).
- **Simulator has no Siri voice.** Voice phrasing can only be confirmed on a physical device.
