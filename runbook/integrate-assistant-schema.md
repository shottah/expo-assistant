# Runbook: Add AssistantSchemas conformance to an AppShortcut (iOS 18+)

Extends `runbook/integrate-app-shortcut.md` with the schema-bound intent path. **Read that runbook first** if you haven't already — schema intents are an additive extension on top of regular AppShortcuts, not a replacement.

This doc is empirically grounded — every claim about runtime behavior has been verified on an iPhone 16 Pro (iOS 26.2, Apple Intelligence enabled) during the #30 pre-merge spike. Where Apple's docs implied something we couldn't reproduce, the runbook calls it out explicitly.

---

## TL;DR — what schemas actually do (and don't)

| You want... | Use this |
|---|---|
| **Voice-triggered actions** ("Hey Siri, open project in MyApp" → intent fires) | Vanilla `AppIntent` with explicit `phrases[]`. **NOT** schemas. |
| **AI-driven surfacing** (Spotlight, "Apple Intelligence suggested for you", contextual UI from screenshots / onscreen content) | Schema-bound intent via `schema: "system.search"` etc. |
| **BOTH** voice triggering AND AI surfacing for the same logical action | Declare **two intents** — vanilla for voice, schema-bound for AI. Route both to the same JS handler. |

**Empirical finding (iPhone 16 Pro / iOS 26.2 / Apple Intelligence on / 2026-05-22):** Direct Siri voice phrases like "Search expo-assistant-example for tacos" — even matching the declared `phrases: ["Search ${applicationName}"]` template — do **NOT** invoke schema-conformant intents. Siri falls through to web search. This is consistent across multiple phrasings (direct, contextual, foreground-app-active, Type-to-Siri). The schema-intent's `phrases[]` array serves as a Shortcuts.app / Spotlight discovery hint only; voice routing for schema intents goes through AI inferential paths, not phrase matching.

---

## When to use schemas vs vanilla intents (corrected from initial draft)

| Use **schema-bound** when... | Stay with **vanilla AppIntent** when... |
|---|---|
| You want the intent to surface in AI-driven contexts (onscreen content suggestions, AI app gallery, semantic cross-app reasoning) | You want users to invoke the action via Siri voice |
| Your action maps cleanly to one of Apple's published schemas (`system.search`, `photos.openAsset`, `journal.createEntry`, etc.) | Your action is bespoke OR doesn't fit a published schema |
| Your target users have iOS 18+ with Apple Intelligence enabled on supported hardware (iPhone 15 Pro+ / 16+ / M-series Macs) | You need voice access on iOS 16/17 or non-AI hardware |
| You're willing to give up control over the intent's `title` and accept the schema's default UX text in Shortcuts.app | You want explicit UX control |

**The compose pattern:** for actions where voice triggering matters AND you want AI surfacing, declare two `appShortcuts[]` entries — a vanilla one with `phrases[]` for voice, and a schema-bound one with `assistantOnly: true` for AI surfaces. Both fire the same JS handler.

```jsonc
{
  "appShortcuts": [
    {
      // Voice-triggerable — Siri matches the phrase template
      "id": "search-products",
      "title": "Search Products",
      "phrases": ["Search ${applicationName} for ${query}"],
      "parameters": [{ "name": "query", "type": "string", "prompt": "Search for?" }]
    },
    {
      // AI-surfaceable — Apple Intelligence reasoning paths
      "id": "search-products-ai",
      "title": "Search Products (AI)",
      "schema": "system.search",
      "assistantOnly": true
    }
  ]
}
```

Both intents route to the same `search-products` JS handler (by using the same handler logic on different `withId(...)` registrations, or by adding a shim handler for the `-ai` variant that delegates). See "Compose pattern in practice" below.

---

## Empirically verified capabilities

Tests run 2026-05-22, iPhone 16 Pro, iOS 26.2, Apple Intelligence enabled, app freshly installed.

| Capability | Schema intent (e.g. `@AppIntent(schema: .system.search)`) | Vanilla intent (no `schema` field) |
|---|---|---|
| Appears in Shortcuts.app "+ Add" picker | ✅ confirmed | ✅ confirmed |
| Displays under schema's default title (e.g. "Search"), not your declared `title` | ✅ confirmed — `title` is owned by schema | n/a — your `title` is used |
| Library tap → `perform()` → JS handler bridge | ✅ confirmed | ✅ confirmed |
| Siri voice via declared phrase ("Hey Siri, search MyApp for X") | ❌ **confirmed not working** — Siri falls back to web search | ✅ works |
| Apple Intelligence semantic routing (context inference) | 🟡 not directly testable via voice; expected to work for surfaces like Spotlight, AI-suggested actions, onscreen content recognition | n/a — vanilla intents do not get this surface |
| Spotlight discovery (typed text) | ✅ confirmed | ✅ confirmed |
| Hidden from Shortcuts.app when `assistantOnly: true` | ✅ confirmed | n/a |
| Prebuild rejection of duplicate `schema:` declarations | ✅ enforced (Apple's per-app per-schema-id uniqueness, binary linker level) | n/a |

The headline takeaway: **schemas enable AI surfaces; voice triggering still happens via vanilla intents.** If voice is the primary invocation pattern you want, schemas alone won't get you there.

---

## Prerequisites

- Expo SDK 54+, iOS deployment target 16.0+ (the schema struct uses `@available(iOS 18.0, *)`; rest of your app can stay on 16+)
- Xcode 16.1+ (Xcode 16.0 had a dyld bug with `AppShortcutsProvider` + schema intents; fixed in 16.1 beta 2)
- For Apple Intelligence surfaces to actually route: iPhone 15 Pro / Pro Max or iPhone 16+, iPad mini (A17 Pro) / M1+ iPad / M1+ Mac / Vision Pro / Apple Watch Series 6+, with **Apple Intelligence enabled in Settings** (not just available — explicitly toggled on), with the AI on-device model downloaded
- For voice triggering (vanilla intent path): any iOS 16+ device with Siri enabled, on a device with `com.apple.developer.siri` entitlement (paid Apple Developer account required for physical device builds — personal teams can't request the Siri capability)

---

## Available schemas (first cut, October 2025)

The plugin's catalog ships at `plugin/src/ios/codegen/schemas/catalog.ts`. Adding new schemas is a catalog-table addition; see Apple's docs at https://developer.apple.com/documentation/appintents/assistantschemas.

| Schema ID | Apple protocol | Required parameters (auto-injected) | Static declarations | Notes |
|---|---|---|---|---|
| `system.search` | `ShowInAppSearchResultsIntent` | `criteria: StringSearchCriteria` | `searchScopes: [StringSearchScope] = [.general]` | General in-app search. The first-cut catalog entry. |

Future schemas (catalog stubs only at first cut): `photos.openAsset`, `journal.createEntry`, `mail.createDraft`, ~120 more. See `.plan/08-assistant-schemas-research.md` § B1 for the full enumeration; track follow-up PRs against #30.

---

## 1. Add a schema-bound shortcut

```jsonc
// app.json
{
  "expo": {
    "ios": { "bundleIdentifier": "com.example.myapp" },
    "plugins": [
      ["expo-assistant", {
        "ios": {
          "appShortcuts": [
            {
              "id": "search-products",
              "title": "Search Products",
              "schema": "system.search",
              "phrases": ["Search ${applicationName}"]
              // NO `parameters` array — `criteria: StringSearchCriteria`
              // is auto-injected from the catalog. Declaring it manually
              // throws at prebuild (would create a duplicate @Parameter).
            }
          ]
        }
      }]
    ]
  }
}
```

This produces a Swift struct like:

```swift
@available(iOS 18.0, *)
@AppIntent(schema: .system.search)
public struct SearchProductsIntent: ShowInAppSearchResultsIntent {
    public static var searchScopes: [StringSearchScope] = [.general]
    public var criteria: StringSearchCriteria
    public init() {}
    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            ExpoAssistantModule.shared?.emitIntent(
                id: "search-products",
                parameters: ["criteria": criteria.term]
            )
        }
        return .result()
    }
}
```

Notes:
- **No `static var title` or `static var description` is emitted** — the `@AppIntent(schema:)` macro owns those when bound to a schema. Apple's official guidance; verified empirically.
- The shortcut appears in Shortcuts.app under the schema's default title (e.g. "Search"), not your declared `title`. Your `title` field becomes plugin-internal documentation; it doesn't render in iOS UX surfaces.
- `phrases` are NOT voice triggers for schema intents — they're discovery hints. Confirmed empirically.

## 2. Wire the JS handler

```ts
import { VoiceAssistant, VoiceIntentBuilder, IntentCategory, ParameterType } from 'expo-assistant';

const va = await VoiceAssistant.initialize({ debugMode: true });

await va.registerIntent(
  VoiceIntentBuilder.create<{ criteria: string }>()
    .withId('search-products')
    .withCategory(IntentCategory.SEARCH)
    .requiredParameter('criteria', { type: ParameterType.STRING })
    .withHandler({
      handle: async ({ criteria }) => {
        // Fires on Library tap. Will fire on AI surfaces too when
        // Apple Intelligence routes through (Spotlight tile, onscreen
        // content suggestions, etc.).
        const results = await searchProducts(criteria);
        return { ok: true, count: results.length };
      },
    })
    .build()
);
```

Same `withId('search-products')` as the `id` in `app.json` — case-sensitive byte-for-byte. The plugin auto-unwraps `StringSearchCriteria` for you; your JS handler receives `criteria: string`.

## 3. Add EXTRA developer parameters beyond the schema's required ones (optional)

If you need fields beyond what the schema's contract requires, declare them in `parameters[]`. Don't redeclare the schema-required ones — the plugin throws at prebuild.

```jsonc
{
  "id": "search-products",
  "title": "Search Products",
  "schema": "system.search",
  "parameters": [
    { "name": "limit", "type": "number", "title": "Result limit" }
    // Don't redeclare "criteria" — it's auto-injected.
  ]
}
```

The JS handler now receives both:

```ts
.requiredParameter('criteria', { type: ParameterType.STRING })
.requiredParameter('limit', { type: ParameterType.NUMBER })
.withHandler({
  handle: async ({ criteria, limit }) => { /* ... */ },
})
```

## 4. The compose pattern (voice + AI for the same action)

If voice triggering matters for the same action you want AI-surfaced, declare two `appShortcuts[]` entries.

```jsonc
{
  "appShortcuts": [
    {
      // Voice-triggerable via Siri phrase template
      "id": "search-voice",
      "title": "Search",
      "phrases": [
        "Search ${applicationName} for ${query}",
        "Find ${query} in ${applicationName}"
      ],
      "parameters": [
        { "name": "query", "type": "string", "prompt": "What are you looking for?" }
      ]
    },
    {
      // AI-surfaceable — Apple Intelligence reasoning paths
      "id": "search-ai",
      "title": "Search (AI surface)",
      "schema": "system.search",
      "assistantOnly": true
    }
  ]
}
```

Wire both JS handlers, possibly sharing implementation:

```ts
async function performSearch(criteria: string) {
  const results = await searchProducts(criteria);
  return { ok: true, count: results.length };
}

await va.registerIntent(
  VoiceIntentBuilder.create<{ query: string }>()
    .withId('search-voice')
    .requiredParameter('query', { type: ParameterType.STRING })
    .withHandler({ handle: async ({ query }) => performSearch(query) })
    .build()
);

await va.registerIntent(
  VoiceIntentBuilder.create<{ criteria: string }>()
    .withId('search-ai')
    .requiredParameter('criteria', { type: ParameterType.STRING })
    .withHandler({ handle: async ({ criteria }) => performSearch(criteria) })
    .build()
);
```

`assistantOnly: true` keeps the schema variant out of the Shortcuts.app picker so users see only the voice-friendly variant. Apple Intelligence sees both and prefers the schema-bound one when reasoning routes apply.

## 5. `assistantOnly` migration knob (existing-intent → schema-bound)

If you're adding schema conformance to an **existing** intent that's in production (and that users may have created Shortcuts referencing), changing its shape breaks those Shortcuts. Apple recommends keeping the original AND adding a new schema-bound `assistantOnly: true` variant — same compose pattern as above.

## 6. Per-schema-id uniqueness (one shortcut per schema per app)

Apple enforces this at the binary linker level. Two intents in one app cannot conform to the same schema. The plugin catches this at prebuild:

```
[expo-assistant] Schema "system.search" declared on multiple shortcuts:
  "search-products" and "search-orders".
  why: Apple enforces per-app per-schema-id uniqueness at the binary linker
       level. Two intents conforming to the same schema produces a build
       failure with a cryptic error pointing at the protocol name rather
       than the schema.
  fix: Pick one shortcut to bind to "system.search" and either remove the
       schema field from the other OR bind it to a different schema. Each
       schema can have exactly one implementing intent per app.
```

If your app has multiple search surfaces, pick the most representative one for schema-binding. The others stay as vanilla intents (which still get all the standard invocation paths).

## 7. Verification on device

- [ ] `bunx expo prebuild --platform ios --clean` succeeds
- [ ] `bunx expo run:ios --device <name>` succeeds (Xcode 16.1+; paid Apple Developer team if building for physical device with Siri entitlement; for personal team builds set `enableSiriKit: false` in the plugin props since personal teams can't request the Siri capability)
- [ ] Shortcuts.app → "+" → search your app name → schema-bound shortcut appears under the schema's default title
- [ ] Tap the shortcut → JS handler fires (visible in Metro)
- [ ] (Voice path) declared `phrases[]` for the schema intent will NOT trigger via Siri voice — this is expected, schemas don't voice-route
- [ ] (Optional, AI-eligible device) Apple Intelligence surfaces — Spotlight tiles, contextual suggestions — should eventually offer the action

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Plugin throws `Shortcut "X" declares schema "Y" which is not in the AssistantSchemas catalog` | `schema` value isn't in the catalog (typo or schema we haven't added) | Check the "Available schemas" table. To add a missing one, append to `plugin/src/ios/codegen/schemas/catalog.ts` per the maintenance guide |
| Plugin throws `Schema "X" declared on multiple shortcuts` | Two `appShortcuts[]` entries share the same `schema` value | Apple's per-app per-schema uniqueness constraint. Pick one shortcut, leave others as vanilla intents |
| Plugin throws `parameter "criteria" is auto-injected by the schema` | You declared a parameter that the schema auto-supplies | Remove that parameter from your `parameters[]` array — the catalog handles it |
| Shortcut shows under "Search" in Shortcuts.app instead of your `title` | `@AppIntent(schema:)` macro owns the title metadata | Expected — your `title` is plugin-internal. To control UX text, use a vanilla intent (drop the `schema` field) |
| Build error: "Personal development teams do not support the Siri capability" | Personal Apple Developer team building for physical device with `com.apple.developer.siri` entitlement | Either (a) upgrade to paid Apple Developer Program, or (b) set `"enableSiriKit": false` in your plugin config — modern AppShortcuts/AppIntents (what we ship) don't actually need this entitlement; it's a legacy SiriKit (`INIntents`) thing |
| Siri voice says "Hey Siri, search MyApp for X" → Siri shows web search results instead | **Expected.** Schema intents don't voice-route via `phrases[]`. | Add a vanilla AppIntent with explicit `phrases[]` for the same action. See the compose pattern above. |
| Xcode 16.0 dyld error like `Symbol not found: _$s10AppIntents15AssistantSchemaV...` | Old Xcode toolchain | Upgrade to Xcode 16.1+ |

## 9. Related docs

- [Apple — AssistantSchemas](https://developer.apple.com/documentation/appintents/assistantschemas)
- [Apple — `@AppIntent(schema:)` macro](https://developer.apple.com/documentation/appintents/appintent(schema:))
- [Apple — Integrating actions with Siri and Apple Intelligence](https://developer.apple.com/documentation/appintents/integrating-actions-with-siri-and-apple-intelligence)
- [WWDC24 — Bring your app to Siri](https://developer.apple.com/videos/play/wwdc2024/10133/)
- [WWDC25 — Develop for Shortcuts and Spotlight with App Intents](https://developer.apple.com/videos/play/wwdc2025/260/)
- `runbook/integrate-app-shortcut.md` — the base AppShortcut runbook for voice-triggerable vanilla intents
- `plugin/SCOPE.md` — package boundary; AssistantSchemas falls on the *invocation* side
- `.plan/08-assistant-schemas-research.md` — the ADR + empirical spike findings backing this guide
