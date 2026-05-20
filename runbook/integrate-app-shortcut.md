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
          "siriUsageDescription": "Open projects via voice",
          "entities": [
            {
              "name": "Project",
              "displayName": "Project",
              "displayProperty": "title",
              "properties": [
                { "name": "title",   "type": "string" },
                { "name": "summary", "type": "string" }
              ]
            }
          ],
          "appShortcuts": [{
            "id": "open-project",
            "title": "Open Project",
            "systemImageName": "folder.fill",
            "phrases": [
              "Open project in ${applicationName}",
              "Show me a project in ${applicationName}"
            ],
            "parameters": [
              { "name": "project", "type": "entity:Project", "title": "Project", "prompt": "Which project?" }
            ]
          }]
        }
      }]
    ]
  }
}
```

One shortcut, one entity-typed parameter. iOS's Library tap UX shows an autocomplete picker that fetches its options from the JS-registered resolver. The handler receives `{ project: { id, title, summary } }`. Voice phrase slots for entity types (`Open ${project} in MyApp`) are gated on the snapshot-store enhancement (#41) — see Phrase rules below.

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
| `entities` | `AppEntityDeclaration[]` | no | `undefined` | Queryable app-data types you reference via `"entity:<Name>"`. Each generates a Swift `AppEntity` + `EntityStringQuery` pair that proxies through a JS-registered resolver (see `registerEntityResolver` below). Drives Library tap autocomplete pickers. Voice slot extraction at install time is gated on #41 (snapshot-store mode). |
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
| `"entity:<Name>"` | references the `<Name>` entity declared under `ios.entities` | the entity's full dict (e.g. `{ id, title, summary }`), pushed back by the JS resolver | ⚠️ AppEntity — Library tap picker works; voice slot extraction gated on #41 |

`IntentFile` and richer measurements (mass, temperature, etc.) are not yet supported.

#### `enums[]` entry

| Field | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `name` | `string` | **yes** | — | Swift type name. Must be a valid Swift identifier — PascalCase by convention (e.g. `"WorkoutType"`). Used as the Swift enum's name AND referenced by parameters via `"enum:<Name>"`. |
| `displayName` | `string` | no | `name` | Becomes `TypeDisplayRepresentation` — human-readable label iOS uses for the enum type itself (e.g. in the Shortcuts editor parameter chooser). |
| `cases` | `{ id, display }[]` | **yes** | — | Allowed values. **At least one.** `id` is the raw Swift case AND the value JS receives via `.rawValue`; must be a valid Swift identifier. `display` is the human-readable label shown in pickers and spoken by Siri. |

#### `entities[]` entry

| Field | Type | Required | Default | Purpose |
|---|---|---|---|---|
| `name` | `string` | **yes** | — | Swift identifier (PascalCase by convention). The generated Swift struct is named `<name>Entity` and is referenced from parameters via `"entity:<Name>"`. |
| `displayName` | `string` | no | `name` | `TypeDisplayRepresentation` shown in the Shortcuts editor + iOS surfaces that name the entity type itself. |
| `displayProperty` | `string` | no | `"title"` if declared as string, else first string property | Which declared property to render as the entity's `DisplayRepresentation` title — shown in pickers, autocomplete, Siri's spoken responses. Must reference a string-typed property. |
| `properties` | `{ name, type }[]` | **yes** | — | Properties on the entity beyond the implicit `id: String`. Types limited to `string`, `number`, `boolean`. At least one string property OR an explicit `displayProperty` is required so `DisplayRepresentation` has a title source. Each becomes a `@Property(title:)`-wrapped Swift `var` (required for AppEntity slot discovery — bare `let`s are invisible to iOS's query mechanism). |

Each declared entity also requires a JS-side resolver registered via `VoiceAssistant.registerEntityResolver(typeName, resolver)` — see "Register a JS handler" below.

#### Phrase template tokens

| Token | Resolves to | Required in every phrase? |
|---|---|---|
| `${applicationName}` | Your app name (or any `alternativeAppNames` alias) | **yes** — iOS silently drops phrases without it |
| `${enumParamName}` | Voice slot for an AppEnum-typed parameter; Siri extracts the spoken case from the user's phrase | optional — only legal when the named parameter is `"enum:<Name>"`-typed; plugin throws otherwise |
| `${entityParamName}` | Voice slot for an AppEntity-typed parameter | optional — plugin accepts at codegen time, but linkd silently drops the phrase at install time because the JS resolver isn't alive yet to provide entity values. Use bare phrases + rely on the Library tap autocomplete picker. Voice-slot extraction unlocks once #41 (snapshot-store) ships. |

**Phrase rules — non-negotiable:**

1. Every phrase **must** include `${applicationName}` somewhere. iOS silently drops phrases without it; the plugin throws at prebuild.
2. **Voice slots accept AppEnum and AppEntity only.** Primitives — `string`, `number`, `boolean`, `date`, `duration`, `length`, `url` — are silently dropped by `linkd` ([Apple DTS engineer ruling](https://developer.apple.com/forums/thread/770037)). The plugin throws at prebuild on `${paramName}` for any primitive-typed param. AppEnum slots fully work today. **AppEntity slots compile but get install-time-rejected by linkd** because the JS resolver isn't live yet to supply entity values — Library tap still works (it doesn't use phrase parsing); voice extraction unlocks once #41 (snapshot-store) ships.
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
import {
  VoiceAssistant,
  VoiceIntentBuilder,
  IntentCategory,
  ParameterType,
  type EntityRecord,
} from 'expo-assistant';

type Project = EntityRecord & { id: string; title: string; summary: string };

const va = await VoiceAssistant.initialize({ debugMode: true });

// Register the entity resolver BEFORE the intent that references the
// entity type. iOS will start asking the resolver as soon as a scan
// triggers; having it ready avoids the first scan returning empty.
va.registerEntityResolver<Project>('Project', {
  matching: async (search) => {
    const q = search.toLowerCase().trim();
    if (!q) return ALL_PROJECTS.slice(0, 5);
    return ALL_PROJECTS.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.summary.toLowerCase().includes(q)
    );
  },
  resolve: async (ids) => ALL_PROJECTS.filter((p) => ids.includes(p.id)),
  suggested: async () => ALL_PROJECTS.slice(0, 3),
});

await va.registerIntent(
  VoiceIntentBuilder.create<{ project: Project }>()
    .withId('open-project')  // case-sensitive; must equal app.json `id` exactly
    .withCategory(IntentCategory.PRODUCTIVITY)
    // Entity-typed parameters arrive as the full dict the resolver
    // returned, with at minimum { id, ...declaredProperties }.
    .requiredParameter('project', { type: ParameterType.OBJECT })
    .withHandler({
      handle: async ({ project }) => ({
        ok: true,
        opened: await openProjectScreen(project.id),
      }),
    })
    .build()
);
```

**Critical:** `withId(...)` must equal the `id` field in `app.json` byte-for-byte. The JS dispatcher does a case-sensitive map lookup. Mismatch is silent (handler never fires).

**Marshaling reference:** when a parameter's `type` is a rich primitive, enum, or entity, the JS side receives a documented shape, not the Swift type. Use the Parameter type vocabulary table above to know what to expect — `date` → ISO 8601 string, `duration` / `length` → `{ value, unit }`, `url` → string, `enum:<Name>` → the case's `id` string, `entity:<Name>` → the full entity dict.

**EntityResolver contract** (`ios.entities[]` types only):

```ts
type EntityResolver<T extends EntityRecord> = {
  matching: (search: string) => Promise<T[]>;  // free-form text → entities; Spotlight autocomplete
  resolve: (ids: string[]) => Promise<T[]>;    // id list → entities; remembers prior bindings
  suggested?: () => Promise<T[]>;              // proactive picks; optional, defaults to []
};
```

- The pod-side bridge enforces a **1-second timeout** — slow resolvers degrade to empty results and the user sees no autocomplete / picker entries for that scan
- Resolvers should be in-memory filters where possible; remote calls work but eat heavily into the timeout budget
- iOS keeps asking the resolver as long as the JS runtime is alive; **when the app is backgrounded, queries time out** because JS isn't responding — see #41 for the snapshot-store enhancement that fixes backgrounded scanning

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
| Siri voice — bare phrase | "Open project in MyApp" | Prompts via `requestValueDialog` for every unbound required parameter (enum → picker, entity → autocomplete via resolver, primitive → typed input), then fires |
| Siri voice — with enum slot | "Start cycling workout in MyApp" | Siri extracts `kind: "cycling"` from the spoken phrase, prompts for any remaining unbound parameters, then fires |
| Siri voice — with entity slot | "Open Atlas in MyApp" (planned) | Currently NOT working — linkd rejects entity slot phrases at install time because the JS resolver isn't live yet. The snapshot-store enhancement (#41) ships this path. |
| Spotlight | swipe down, type phrase, tap tile | Same as Library tap |
| Shortcuts.app → Library | tap auto-listed tile under your app | Prompts for unbound required parameters one at a time. Enum → picker. Entity → autocomplete fed by the JS resolver. Duration → native duration input. Primitive → typed input. Then fires. |
| Long-press app icon | suggested actions menu | Same as Library tap |

Note: voice-slot extraction works for **AppEnum** parameters today. **AppEntity** voice slots compile but get rejected by linkd at install scan; the Library tap path exercises the same resolver bridge and works end-to-end.

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

- **Voice slots fully work for AppEnum today.** **AppEntity slots work for Library tap (entity picker)** but voice extraction at install time is gated on #41 (snapshot-store mode) — linkd ingests phrases before the JS resolver is alive, so entity slot phrases are rejected on install.
- **Backgrounded entity scans return empty.** When the host app is backgrounded or terminated, the JS resolver isn't alive, so the pod's 1-second timeout fires and Spotlight / picker UX gets empty results. #41 fixes this.
- **No `IntentFile` yet.** File-handle lifecycle + binary payload bridging needs its own slice.
- **No Apple Intelligence schema conformance** — custom AppIntent only. #30 (blocked on #35 research).
- **No result presentation surfaces** — no `ProvidesDialog` / `ShowsSnippetView` / `OpensIntent` / `ReturnsValue`. #31.
- **~10 AppShortcuts per app**, ~5–10 phrases per shortcut (Apple's practical budget).
- **Simulator has no Siri voice.** Voice phrasing can only be confirmed on a physical device — the prompt path can be fully exercised in the simulator via Library tap.
