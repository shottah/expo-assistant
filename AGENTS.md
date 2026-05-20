# AGENTS.md

Guidance for agents (Claude, Codex, Cursor, human contributors with agent assistants) working on this repo. Read this before making architectural changes.

---

## What this package is

`expo-assistant` is an Expo native module + config plugin that bridges iOS Siri / App Intents and Android Google Assistant / App Actions to a unified TypeScript API. Apps declare voice intents in `app.json`, register handlers via a fluent builder, and (eventually — see matrix below) get JS callbacks when the OS fires a voice trigger.

## Core architecture: three flows, two directions

Every voice-intent operation maps to one of three flows. Don't conflate them — they're different lifecycle moments with different APIs on each platform.

| Flow | Direction | Purpose |
|---|---|---|
| **Register** | JS → Native → OS | Declare "my app supports this intent type." Static capability declaration. |
| **Donate** | JS → Native → OS | Report "user just did X with these params." Dynamic event log, teaches the OS to predict. |
| **Invoke** | OS → Native → JS | OS fires the voice trigger; app handler runs. Reactive. |

The `.plan/data-flow.md` doc has full mermaid diagrams of each flow.

## Implementation matrix (status)

| | Register | Donate | Invoke |
|---|---|---|---|
| **iOS** | ✅ `AppShortcutsProvider` codegen + per-shortcut typed `AppIntent` structs (#22, #25) — supports multi-param + AppEnum + rich primitive types (#29 in flight) | ✅ `IntentDonationManager.shared.donate(intent:)` (#27) | ✅ `GenericVoiceIntent.perform()` + typed-intent equivalents route to `ExpoAssistantModule.shared.emitIntent` → JS handler (#22) |
| **Android** | 🚧 #17 (today: wrong API — launcher only, not Assistant) | 🚧 #18 (today: dead broadcast) | 🚧 #11 (today: missing) |

Open epics for iOS box-expansion: #25 multi-param ✅ · #29 AppEnum + rich primitives (in flight) · #28 AppEntity · #30 AssistantSchemas (blocked on #35) · #31 result surfaces · #32 audio · #33 widgets · #34 controls. Plus #14 (matrix docs sync), #23 (CI iOS build), #24 (Maestro iOS), #36 (example expansion phased w/ #28/#29), #37 (`${query}` slot bug — won't fix until #28/#29).

## Push-only invocation — DO NOT reintroduce a subscription model

When the OS fires a voice trigger, the JS layer routes the invocation **directly** to the registered intent handler. Exactly one handler per intent. No observer fan-out for invocation events.

**Why this rule exists:**

- iOS `AppIntent.perform()` is one method per intent type — OS routes to it. No subscription.
- Android intent-filter routes to one component. No subscription.
- A parallel subscription model in JS would invent semantics neither platform supports, creating ambiguity about "who's authoritative — the handler or the observers?"

**The handler IS the action.** If you want logging, analytics, or other cross-cutting concerns, wrap the handler with a higher-order function (middleware), don't add an observer path.

**The observer bus** (`voiceAssistant.addEventListener`) IS appropriate for system / lifecycle events that don't have a natural handler home:
- `onIntentCompleted` — JS-broadcast after a handler returns successfully
- `onIntentFailed` — JS-broadcast after a handler throws

These are decoupled from action logic and are typed in `VoiceEvent.type`.

**Concretely**: do not add `"onIntentInvoked"` (or any per-invocation event name) to `VoiceEvent.type`. Do not call `this.emitEvent(...)` from `handleIntentInvoked`.

## Cross-platform contract

`src/__tests__/CrossPlatformContract.test.ts` parses the native Swift and Kotlin source files and asserts both platforms expose the **same set** of `AsyncFunction("name")` registrations. If you add or rename a method on one platform, the test fails until the other matches and the TS shim is updated. This is the source of truth for API symmetry — don't disable it.

## Native modules: when to use what

- `AsyncFunction("name")` — JS-callable from `ExpoAssistantModule.<name>(...)`. Use for one-shot operations (initialize, register, donate, get capability). Returns a Promise.
- `Events("name1", "name2")` — Native → JS event channel. Use for OS-initiated callbacks (invocation, lifecycle status). JS subscribes via `ExpoAssistantModule.addListener("name", cb)`.
- `Function("name")` — synchronous JS-callable. Avoid unless there's a measured reason; AsyncFunction is the default.

If you add an AsyncFunction on iOS, add the matching one on Android (and vice versa) or the contract test fails.

## Plans

Working plans live in `.plan/` (local-only, excluded via `.git/info/exclude` — never commit). Each is a TDD-style implementation guide:

- `01-release-process.md` — shipped
- `02-testing-depth.md` — mostly shipped
- `03-value-proposition.md` — in progress (the 6-cell matrix above)
- `04-docs-consolidation.md` — shipped
- `05-follow-ups.md` — Tier 1 shipped; others open
- `06-testing-robustness.md` — shipped
- `data-flow.md` — the JS↔Native bridge architecture reference

## Build, test, lint

```bash
bun install                          # root deps
cd example && bun install            # example app deps for native builds

bun run build                        # tsc + plugin compile
bun run lint                         # eslint (flat config, eslint@9)
bun run test                         # jest, JS + plugin unit tests
bun run test --coverage              # also generate lcov for Codecov

bun run test:ios                     # XCTest via the example workspace
bun run test:android                 # gradle :expo-assistant:jacocoTestReport
```

CI gates on the JS path (build + lint + test) on every PR. Native test jobs are configured but gated by a `native-tests` GitHub environment requiring manual approval — see PR #7 for the setup.

## PR conventions

- Squash merges only (`gh pr merge --squash --delete-branch`)
- Conventional-commit prefix in PR titles (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`, `ci:`)
- Each PR closes one or more issues; reference them in the body
- Don't poll CI from a session — push, surface, move on
- Don't commit `.plan/` files

## Reference docs

When working in this repo, **prefer Apple's primary sources over your training data** — App Intents has shipped substantial changes every iOS release since 16, and several behaviors documented here are pinned to specific Apple statements (the most load-bearing one being the AppShortcutPhrase parameter-type constraint, see #37).

### iOS / App Intents (the dominant surface today)

| Topic | Source | Use when |
|---|---|---|
| `AppIntent` protocol | https://developer.apple.com/documentation/appintents/appintent | Designing the base shape of any new intent type. The plugin's generated typed-intent struct conforms to this. |
| `AppShortcut` | https://developer.apple.com/documentation/appintents/appshortcut | Adding or modifying the per-shortcut declarations in `AppShortcutsBridge.generated.swift`. |
| `AppShortcutsProvider` | https://developer.apple.com/documentation/appintents/appshortcutsprovider | Touching the provider that lists all shortcuts. Note Apple's 10-shortcut-per-app cap. |
| `AppShortcutPhrase` | https://developer.apple.com/documentation/appintents/appshortcutphrase | Anything to do with phrase templates, `${applicationName}`, parameter slots. **Critical**: only `AppEntity` / `AppEnum` types are valid as voice slots — see DTS engineer ruling https://developer.apple.com/forums/thread/770037 + our #37. |
| `Parameter` (property wrapper) | https://developer.apple.com/documentation/appintents/parameter | Adding new parameter types in the plugin codegen. `requestValueDialog` is what triggers needs-value prompts. |
| `ParameterSummary` / `Summary` | https://developer.apple.com/documentation/appintents/parametersummary | Tuning how iOS prompts for missing values from Library tap. Inlining `$paramName` in the summary string is what makes the param a primary parameter that gets prompted (vs trailing-closure "other" params which iOS skips silently). |
| `AppEnum` | https://developer.apple.com/documentation/appintents/appenum | Adding closed-set picker types. AppEnum is one of two Apple-valid voice slot types (see AppShortcutPhrase row). |
| `AppEntity` + `EntityQuery` | https://developer.apple.com/documentation/appintents/appentity + https://developer.apple.com/documentation/appintents/entityquery | The other voice-slottable type — for queryable app data. Tracked in #28 (not yet implemented). |
| `IntentResult` family | https://developer.apple.com/documentation/appintents/intentresult | Result presentation surfaces (`ProvidesDialog`, `ShowsSnippetView`, `OpensIntent`, `ReturnsValue`). Tracked in #31. |
| `IntentDonationManager` | https://developer.apple.com/documentation/appintents/intentdonationmanager | The modern iOS 16+ donate API. We use `.shared.donate(intent:)` in `ExpoAssistantModule.IntentHandler.donate`. |
| `AssistantSchemas` | https://developer.apple.com/documentation/appintents/assistantschemas | Apple Intelligence schema conformance (iOS 18+). Tracked in #30 (blocked on #35 research). |
| `Measurement` (Foundation) | https://developer.apple.com/documentation/foundation/measurement | Working with `duration` / `length` parameter types. Marshaled to JS as `{value, unit}` where `unit` is the symbol. |
| `ISO8601DateFormatter` | https://developer.apple.com/documentation/foundation/iso8601dateformatter | The `date` parameter type marshals to JS via this. Plugin emits the formatter once when any Date param is declared. |

### Android (parity in flight)

| Topic | Source | Use when |
|---|---|---|
| App Actions overview | https://developer.android.com/guide/app-actions/overview | Working on the Android intent invocation flow (#11). |
| Built-in intents (BIIs) | https://developer.android.com/reference/app-actions/built-in-intents | Mapping shortcuts to Google's predefined intent categories. |
| `ShortcutManagerCompat.pushDynamicShortcut` | https://developer.android.com/reference/androidx/core/content/pm/ShortcutManagerCompat | Implementing register + donate properly (#17 / #18). |
| `shortcuts.xml` capability bindings | https://developer.android.com/guide/topics/ui/shortcuts/creating-shortcuts#static | Declaring static shortcut-to-capability bindings the plugin needs to generate. |

### WWDC sessions (more "why", less "how")

| Session | Source | Worth watching when |
|---|---|---|
| WWDC22 — Implement App Shortcuts with App Intents | https://developer.apple.com/videos/play/wwdc2022/10170/ | First time touching App Intents. Establishes the core mental model. |
| WWDC23 — Spotlight your app with App Shortcuts | https://developer.apple.com/videos/play/wwdc2023/10102/ | Discoverability questions (Spotlight, parameterized phrases). |
| WWDC24 — Bring your app to Siri | https://developer.apple.com/videos/play/wwdc2024/10133/ | When scoping #30 (AssistantSchemas / Apple Intelligence). |
| WWDC25 — Develop for Shortcuts and Spotlight with App Intents | https://developer.apple.com/videos/play/wwdc2025/260/ | The current canonical session. Cite this when in doubt about modern best practice. |

### Repo-internal references

- `runbook/integrate-app-shortcut.md` — developer-facing integration guide. Keep this in sync when changing the public surface.
- `ios/AppShortcutsBridge.swift` — pod-side `GenericVoiceIntent` declaration. Has inline `///` citations to the Apple docs for the types it uses.
- `plugin/src/withIOSVoiceIntents.ts` — codegen logic. The phrase validation + slot rules in `buildPhraseLiteral` are pinned to the DTS engineer ruling cited above.
- Generated `AppShortcutsBridge.generated.swift` — top-of-file header lists Apple doc URLs for every Apple type it touches. If you change what the plugin emits, update those citations too.

## Things NOT to do

- Don't reintroduce an observer path for invocation events. See "Push-only invocation" above.
- Don't add new event names to `VoiceEvent.type` without an `onIntentCompleted` / `onIntentFailed`-style lifecycle rationale.
- Don't conflate register and donate as one operation. They map to different native APIs on both platforms — see the matrix.
- Don't widen native API surface without updating both platforms + the cross-platform contract test.
- Don't disable failing tests. Fix or delete with a written reason in the commit.
