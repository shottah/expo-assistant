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
| **iOS** | 🚧 #13 (today: stub) | ✅ NSUserActivity.becomeCurrent | 🚧 #12 (today: missing) |
| **Android** | 🚧 #17 (today: wrong API — launcher only, not Assistant) | 🚧 #18 (today: dead broadcast) | 🚧 #11 (today: missing) |

Plus #10 (JS event channel foundation — this PR), #14 (docs matrix update), #15 (E2E test), #19 (iOS INInteraction upgrade — optional polish), #20 (collapse setup/initialize), #21 (this push-only refactor — folded into #10's PR).

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

## Things NOT to do

- Don't reintroduce an observer path for invocation events. See "Push-only invocation" above.
- Don't add new event names to `VoiceEvent.type` without an `onIntentCompleted` / `onIntentFailed`-style lifecycle rationale.
- Don't conflate register and donate as one operation. They map to different native APIs on both platforms — see the matrix.
- Don't widen native API surface without updating both platforms + the cross-platform contract test.
- Don't disable failing tests. Fix or delete with a written reason in the commit.
