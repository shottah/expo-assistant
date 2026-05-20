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
        "intents": ["health"],
        "ios": {
          "siriUsageDescription": "Start workouts via voice",
          "enums": [
            {
              "name": "WorkoutType",
              "displayName": "Workout Type",
              "cases": [
                { "id": "running", "display": "Running" },
                { "id": "cycling", "display": "Cycling" },
                { "id": "swimming", "display": "Swimming" }
              ]
            }
          ],
          "appShortcuts": [{
            "id": "start-workout",
            "title": "Start Workout",
            "systemImageName": "figure.run",
            "phrases": [
              "Start ${kind} workout in ${applicationName}",
              "Begin ${kind} in ${applicationName}",
              "Start workout in ${applicationName}"
            ],
            "parameters": [
              { "name": "kind",     "type": "enum:WorkoutType", "title": "Workout", "prompt": "Which workout?" },
              { "name": "duration", "type": "duration",         "title": "Duration", "prompt": "How long?" }
            ]
          }]
        }
      }]
    ]
  }
}
```

One shortcut, one enum + one Measurement. The `${kind}` slot in the phrase is voice-extractable ("Start cycling workout in MyApp" → `kind: "cycling"`) because the parameter is `AppEnum`-typed; primitives can't appear as slots. The handler receives `{ kind: "cycling", duration: { value: 30, unit: "min" } }`.

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
| `appShortcuts` | `AppShortcut[]` | no | `[]` | Voice-triggered shortcuts that appear in Shortcuts.app / Spotlight / Siri. See `appShortcuts[]` table below. **Up to ~10 per app** (Apple limit). |
| `enums` | `AppEnumDeclaration[]` | no | `undefined` | Closed-set picker types you can reference from `appShortcuts[].parameters[].type` via `"enum:<Name>"`. Each generates a Swift `AppEnum`-conforming type. AppEnum is one of two Apple-valid voice slot types — see Phrase rules below. |
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
| `type` | parameter type literal | **yes** | — | See the type vocabulary table below. |
| `title` | `string` | no | `name` capitalized | Display title used by `@Parameter(title:)`. |
| `prompt` | `string` | no | `undefined` | Text iOS speaks/shows when the parameter is unbound at invocation time. Becomes `requestValueDialog`. If omitted, iOS uses its default phrasing. |

#### Parameter type vocabulary

| `type` | Swift type emitted | JS handler receives | Voice-slottable in phrases? |
|---|---|---|---|
| `"string"` | `String` | `string` | ❌ primitive (#37) |
| `"number"` | `Double` | `number` | ❌ primitive |
| `"boolean"` | `Bool` | `boolean` | ❌ primitive |
| `"date"` | `Date` | ISO 8601 `string` | ❌ primitive |
| `"duration"` | `Measurement<UnitDuration>` | `{ value: number, unit: string }` (unit is the symbol, e.g. `"min"`) | ❌ primitive |
| `"length"` | `Measurement<UnitLength>` | `{ value: number, unit: string }` (e.g. `"km"`) | ❌ primitive |
| `"url"` | `URL` | `string` (absoluteString) | ❌ primitive |
| `"enum:<Name>"` | references the `<Name>` enum declared under `ios.enums` | the case's `id` string (e.g. `"running"`) | ✅ AppEnum — Apple-valid voice slot |

`IntentFile`, `AppEntity`, and richer measurements (mass, temperature, etc.) are not yet supported.

#### `enums[]` entry

| Field | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `name` | `string` | **yes** | — | Swift type name. Must be a valid Swift identifier — PascalCase by convention (e.g. `"WorkoutType"`). Used as the Swift enum's name AND referenced by parameters via `"enum:<Name>"`. |
| `displayName` | `string` | no | `name` | Becomes `TypeDisplayRepresentation` — human-readable label iOS uses for the enum type itself (e.g. in the Shortcuts editor parameter chooser). |
| `cases` | `{ id, display }[]` | **yes** | — | Allowed values. **At least one.** `id` is the raw Swift case AND the value JS receives via `.rawValue`; must be a valid Swift identifier. `display` is the human-readable label shown in pickers and spoken by Siri. |

#### Phrase template tokens

| Token | Resolves to | Required in every phrase? |
|---|---|---|
| `${applicationName}` | Your app name (or any `alternativeAppNames` alias) | **yes** — iOS silently drops phrases without it |
| `${enumParamName}` | Voice slot for an AppEnum-typed parameter; Siri extracts the spoken case from the user's phrase | optional — only legal when the named parameter is `"enum:<Name>"`-typed; plugin throws otherwise |

**Phrase rules — non-negotiable:**

1. Every phrase **must** include `${applicationName}` somewhere. iOS silently drops phrases without it; the plugin throws at prebuild.
2. **Only AppEnum (and eventually AppEntity, #28) types can appear as voice slots.** Primitives — `string`, `number`, `boolean`, `date`, `duration`, `length`, `url` — are silently dropped by `linkd` ([Apple DTS engineer ruling](https://developer.apple.com/forums/thread/770037)). The plugin throws at prebuild on `${paramName}` for any primitive-typed param. For free-form text slots, model the value as an AppEntity once #28 lands; until then, use the prompt path.
3. The prompt path always works: declare the parameter without a slot in the phrase. iOS fires `requestValueDialog` (sourced from your `prompt`) when the user invokes the shortcut without a bound value. Works for every type, including primitives.
4. Declare 3–5 phrase variants per shortcut covering preposition swaps (`in`/`with`/`on`) and verb synonyms (`Start`/`Begin`/`Open`). iOS does not auto-synonymize connectors.
5. Want a shorter spoken form? Add `ios.alternativeAppNames: ["MA", ...]` — iOS accepts any alias in the `${applicationName}` slot.

## 2. Prebuild

```bash
bunx expo prebuild --platform ios
```

Generates `ios/<YourApp>/AppShortcutsBridge.generated.swift` and registers it in the Xcode pbxproj's Compile Sources phase.

## 3. Register a JS handler

Register one `requiredParameter(...)` per parameter you declared in `app.json`. The handler receives a dict keyed by parameter name.

```ts
import { VoiceAssistant, VoiceIntentBuilder, IntentCategory, ParameterType } from 'expo-assistant';

type WorkoutKind = 'running' | 'cycling' | 'swimming';
type Duration = { value: number; unit: string };

const va = await VoiceAssistant.initialize({ debugMode: true });

await va.registerIntent(
  VoiceIntentBuilder.create<{ kind: WorkoutKind; duration: Duration }>()
    .withId('start-workout')  // case-sensitive; must equal app.json `id` exactly
    .withCategory(IntentCategory.HEALTH)
    // Enum types arrive as the case's `id` string — narrow with a union type.
    .requiredParameter('kind', { type: ParameterType.STRING })
    // Measurement types arrive as { value, unit } objects.
    .requiredParameter('duration', { type: ParameterType.OBJECT })
    .withHandler({
      handle: async ({ kind, duration }) => ({
        ok: true,
        started: await startWorkout(kind, duration.value, duration.unit),
      }),
    })
    .build()
);
```

**Critical:** `withId(...)` must equal the `id` field in `app.json` byte-for-byte. The JS dispatcher does a case-sensitive map lookup. Mismatch is silent (handler never fires).

**Marshaling reference:** when a parameter's `type` is a rich primitive or an enum, the JS side receives a documented shape, not the Swift type. Use the Parameter type vocabulary table above to know what to expect — `date` → ISO 8601 string, `duration` / `length` → `{ value, unit }`, `url` → string, `enum:<Name>` → the case's `id` string. The handler's TypeScript generic can encode this for compile-time safety.

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
| Siri voice — bare phrase | "Start workout in MyApp" | Prompts via `requestValueDialog` for every unbound required parameter, then fires |
| Siri voice — with enum slot | "Start cycling workout in MyApp" | Siri extracts `kind: "cycling"` from the spoken phrase; still prompts for any unbound non-enum parameters; then fires |
| Spotlight | swipe down, type phrase, tap tile | Same as Library tap |
| Shortcuts.app → Library | tap auto-listed tile under your app | Prompts for unbound required parameters one at a time (enum → picker UX, duration → native duration input, etc.); then fires |
| Long-press app icon | suggested actions menu | Same as Library tap |

Note: voice-slot extraction only works for **AppEnum** parameters (and `AppEntity` once #28 lands). Primitive types fall back to the prompt path on every invocation surface.

Handler runs in your app's process — Expo runtime is up, no cold-start penalty if foregrounded or recent.

## 6. Donate (optional)

```ts
await va.donateIntent('start-workout', {
  kind: 'cycling',
  duration: { value: 30, unit: 'min' },
});
```

Hints to iOS that the user just did this action. Does **not** invoke. Feeds Siri suggestions, Spotlight Recents, lock-screen surfacing. No immediate visible effect. Call from JS after a successful user action, not on registration.

## 7. Verify (in order, stop at first failure)

- [ ] App launches; status text shows `registered`
- [ ] `linkd` ingested metadata: `xcrun simctl spawn booted log show --predicate 'subsystem == "com.apple.appintents"' --last 1m | grep -i "your-bundle\|skipping phrase"` — expect `Found static metadata file`, no `Skipping phrase` errors
- [ ] Spotlight: shortcut tile appears with your icon (not Safari compass)
- [ ] Shortcuts.app → Library: your app section appears with the shortcut listed
- [ ] Tap from Library → first parameter's `prompt` text appears → enter / pick value → next parameter's prompt → … → handler fires; example app shows the captured payload

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Shortcut absent from Spotlight/Library | Phrase missing `${applicationName}` | Add token; plugin should throw at prebuild |
| `linkd` log: `Skipping phrase missing an ${applicationName} token` | Same | Same |
| Library tap fires immediately, handler gets `null` or missing values | Parameter is optional in your generated intent (or you forked the pod and made one optional) | iOS skips optional parameters silently. Either declare them required or use the `prompt` field to drive the needs-value flow. |
| Plugin throws `Phrase ... references "${name}" ... type "string" ... only accepts AppEntity / AppEnum` | You tried to put a primitive parameter in a phrase slot | Remove the slot from the phrase (rely on the prompt) OR change the parameter to an enum and declare it under `ios.enums[]` |
| Plugin throws `references enum "Foo" which is not declared in ios.enums[]` | Parameter `type: "enum:Foo"` references a missing enum declaration | Add a matching entry to `ios.enums[]` with the same `name` |
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
print('Actions:', list(d['actions'].keys()))
print()
print('Enums:', json.dumps(d.get('enums', []), indent=2)[:500])
print()
print('autoShortcuts:')
for sc in d.get('autoShortcuts', []):
    print(' ', sc.get('actionIdentifier'))
    for pt in sc.get('phraseTemplates', []):
        print('   ', pt.get('key'))
"
```

Key things to check:
- For each declared parameter on a typed intent: `parameters[<name>].isOptional: false` — required for prompts to work
- For the legacy `GenericVoiceIntent` (back-compat path), `parameters[query].isOptional: false`
- `actionConfiguration.actionSummary.summaryString.parameterIdentifiers` lists every declared parameter (so iOS treats each as a primary parameter that gets prompted)
- `autoShortcuts[].phraseTemplates[].key` shows your phrases — `${applicationName}` and any `${enumParamName}` tokens both legal
- Top-level `enums` array contains a registered entry for every type you declared under `ios.enums[]`, with the expected `cases[].identifier` values

## 10. Current limits

- **Voice slots only work for AppEnum types** today. `AppEntity` slots — the way to make free-form text like search queries or note bodies voice-extractable — land with #28 + use `EntityStringQuery` to resolve any spoken string. Primitives (string / number / boolean / date / duration / length / url) can NEVER appear as phrase slots per Apple's design; they fall back to the prompt path.
- **No `IntentFile` yet.** File-handle lifecycle + binary payload bridging needs its own slice.
- **No entities** — no autocomplete or disambiguation against app data. #28.
- **No Apple Intelligence schema conformance** — custom AppIntent only. #30 (blocked on #35 research).
- **No result presentation surfaces** — no `ProvidesDialog` / `ShowsSnippetView` / `OpensIntent` / `ReturnsValue`. #31.
- **~10 AppShortcuts per app**, ~5–10 phrases per shortcut (Apple's practical budget).
- **Simulator has no Siri voice.** Voice phrasing can only be confirmed on a physical device — the prompt path can be fully exercised in the simulator via Library tap.
