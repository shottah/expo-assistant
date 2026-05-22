# Runbook: Add AssistantSchemas conformance to an AppShortcut (iOS 18+)

Extends `runbook/integrate-app-shortcut.md` with the schema-bound intent path. **Read that runbook first** if you haven't already — schema intents are an additive extension on top of regular AppShortcuts, not a replacement.

Schema-bound intents tell Apple Intelligence what your intent *semantically means* using Apple's predefined contracts. The OS can then route to your intent through reasoning, context inference, and cross-app composition — not just from declared voice phrase templates. See `.plan/08-assistant-schemas-research.md` and #30 for the research that drove this design.

## When to use schemas vs vanilla intents

| Use schema-bound when... | Stay with vanilla intent when... |
|---|---|
| Your intent's action maps cleanly to one of Apple's published schemas (search / open / create / delete / etc. in a specific domain) | Your intent's action is bespoke to your app and doesn't fit any schema |
| You want Apple Intelligence to route to your intent from context (e.g., user looking at recipe → suggest sending to your grocery list) | Voice phrase templates + Spotlight cover your invocation surface |
| Your target audience has iOS 18+ adoption you care about | You need to support iOS 16/17 widely |
| You're willing to give up control over the intent's `title` / `description` (the schema owns those) | You want full control of the Shortcuts UX text |

Schemas are *additive*: a schema-bound intent still appears in Shortcuts.app, Spotlight, and Siri voice paths exactly like a vanilla intent — it just *also* becomes Apple-Intelligence-routable. The downside is the iOS 18+ floor for the schema struct and the loss of control over title/description.

## Prerequisites

- Expo SDK 54+, iOS deployment target 16.0+ (schema struct uses `@available(iOS 18.0, *)`)
- For Apple Intelligence routing on-device: iPhone 15 Pro / Pro Max or iPhone 16+, iPad mini A17 Pro+ / M1+ iPad / M1+ Mac / Apple Vision Pro / Apple Watch Series 6+. **On older but iOS-18-capable hardware** (e.g., iPhone 15 non-Pro): schema intents still work via Shortcuts.app + Spotlight + Siri voice — only AI-routed invocations are skipped. Graceful degradation is automatic.
- Xcode 16.1+ recommended (Xcode 16.0 had a dyld bug with `AppShortcutsProvider` + schema intents that was fixed in 16.1 beta 2)

## Available schemas (first cut)

The plugin's catalog (`plugin/src/ios/codegen/schemas/catalog.ts`) ships these schemas. Adding new schemas is a catalog-table addition; see Apple's docs at https://developer.apple.com/documentation/appintents/assistantschemas.

| Schema ID | Apple protocol | Required parameters | Static declarations | Notes |
|---|---|---|---|---|
| `system.search` | `ShowInAppSearchResultsIntent` | `criteria: StringSearchCriteria` (auto-injected) | `searchScopes: [StringSearchScope] = [.general]` | General in-app search. Most common starting schema. |

Future-PR schemas (catalog stubs only at first cut): `photos.openAsset`, `journal.createEntry`, `mail.createDraft`, etc. — see the full enumeration in `.plan/08-assistant-schemas-research.md` § B1.

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
              // Note: NO `parameters` array — the schema's required
              // `criteria: StringSearchCriteria` parameter is auto-
              // injected from the catalog. You only declare params for
              // EXTRA fields beyond what the schema requires.
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

Note that **no `static var title` or `static var description` is emitted** — the `@AppIntent(schema:)` macro owns those when bound to a schema (Apple's official guidance, verified empirically in the pre-implementation spike). The UX consequence: your shortcut will appear in Shortcuts.app under the schema's default title (e.g., "Search") rather than under the `title` you declared. That's an unavoidable trade-off; the `title` field is still useful as documentation but won't render.

## 2. Add EXTRA parameters beyond the schema's required ones (optional)

If you need fields beyond what the schema's contract requires, declare them in `parameters[]`. Don't redeclare the schema-required ones — the plugin throws at prebuild if you do.

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

The JS handler then receives both the schema-required `criteria` (as a plain string — the plugin unwraps `StringSearchCriteria.term` for you) AND your extra `limit` field:

```ts
await va.registerIntent(
  VoiceIntentBuilder.create<{ criteria: string; limit: number }>()
    .withId('search-products')
    .requiredParameter('criteria', { type: ParameterType.STRING })
    .requiredParameter('limit', { type: ParameterType.NUMBER })
    .withHandler({
      handle: async ({ criteria, limit }) => {
        const results = await searchProducts(criteria, { limit });
        return { ok: true, count: results.length };
      },
    })
    .build()
);
```

## 3. AppShortcutsProvider behavior with mixed iOS 16+ and iOS 18+ shortcuts

When your `appShortcuts[]` mixes schema-bound (iOS 18) and vanilla (iOS 16+) entries, the plugin emits a conditional pattern in the generated `AppShortcutsProvider`:

```swift
public struct ExpoAssistantAppShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        var shortcuts: [AppShortcut] = [
            // iOS 16+ vanilla shortcuts here
        ]
        if #available(iOS 18.0, *) {
            shortcuts.append(/* schema-bound shortcut */)
        }
        return shortcuts
    }
}
```

This keeps the entire iOS deployment target at 16.0+ while still emitting iOS 18 schema intents. No additional action required from you — it's automatic.

## 4. `assistantOnly` migration knob

If you're adding schema conformance to an **existing** intent that's already in production (and that users may have created Shortcuts referencing), modifying its shape can break those Shortcuts. Apple recommends creating a NEW schema-bound intent with `assistantOnly: true` and keeping the original intent for back-compat.

```jsonc
{
  "appShortcuts": [
    {
      // Original intent — keep for users with saved Shortcuts.
      "id": "search-products",
      "title": "Search Products"
    },
    {
      // New schema-bound intent — only Apple Intelligence can route here.
      "id": "search-products-ai",
      "title": "Search Products (AI)",
      "schema": "system.search",
      "assistantOnly": true
    }
  ]
}
```

The `assistantOnly` intent vanishes from Shortcuts.app Library and from Spotlight — users see only the original. Apple Intelligence sees both and prefers the schema-bound one when reasoning routes apply.

**Caveat:** voice-routing behavior with `isAssistantOnly` is unverified on simulator (spike Q3 deferred). On Apple-Intelligence-eligible hardware it should work as Apple intends; on non-AI hardware, your `assistantOnly` intent is effectively dead weight. Use deliberately.

## 5. Per-schema-id uniqueness (one shortcut per schema per app)

Apple enforces this at the binary linker level — two intents in one app cannot both conform to the same schema. The plugin catches this at prebuild and throws:

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

If your app has multiple search surfaces, pick the one that's most representative for schema-binding. The others can stay as vanilla intents — they still get all the usual invocation paths.

## 6. Verify

- [ ] `bunx expo prebuild --platform ios` succeeds
- [ ] `bunx expo run:ios` succeeds (Xcode 16.1+ required for clean dyld behavior)
- [ ] Shortcuts.app → "+" → search your app name → schema-bound shortcut appears with the schema's default title
- [ ] Tap the shortcut → `perform()` fires → JS handler receives the parameter values
- [ ] (On Apple-Intelligence-eligible hardware) Siri voice + Apple Intelligence routes to the intent via semantic reasoning, not just declared phrase templates

## 7. Current limits (first cut)

- **One schema supported in catalog:** `system.search`. Adding `photos.openAsset`, `journal.createEntry`, and the full 125-schema enumeration are tracked in follow-up PRs against #30.
- **Voice routing for schema intents requires real-device verification** for production confidence. Library tap path is fully confirmed; voice routing on simulator showed inconclusive behavior (web search fallback instead of intent invocation — likely a Cmd+Option+S simulator artifact, but worth verifying on a physical device before shipping).
- **Entity schemas not yet supported** — the `schema` field on entity declarations is a follow-up. Today, schema intents that need entity-typed parameters (e.g., `photos.openAsset` needing a `PhotoEntity`) can't be expressed.
- **No `refresh-schemas.mjs` scraper yet** — the catalog table is hand-maintained. When Apple adds schemas at WWDC, add entries to `plugin/src/ios/codegen/schemas/catalog.ts` manually. Scraper script tracked as a follow-up issue.
- **AssistantSchemas requires iOS 18.0+** — the schema struct gates with `@available(iOS 18.0, *)`. Your app's deployment target can stay at iOS 16+; only the schema-bound struct (and the conditional append in the provider) gates higher.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Plugin throws `Shortcut "X" declares schema "Y" which is not in the AssistantSchemas catalog` | `schema` value isn't in the catalog (typo, or a schema we haven't yet added) | Check the table in section "Available schemas" above. If you need a schema not listed, add it to `plugin/src/ios/codegen/schemas/catalog.ts` per the maintenance guide |
| Plugin throws `Schema "X" declared on multiple shortcuts` | Two `appShortcuts[]` entries share the same `schema` value | Apple's per-app per-schema uniqueness constraint. Pick one shortcut, leave the others as vanilla intents |
| Plugin throws `parameter "criteria" is auto-injected by the schema` | You declared a parameter that the schema auto-supplies | Remove that parameter from your `parameters[]` array — the catalog handles it |
| Shortcut shows under "Search" in Shortcuts.app instead of your declared `title` | `@AppIntent(schema:)` macro takes ownership of `title` | This is expected behavior — the schema's default title displays. Your `title` field becomes documentation only. To change UX text, use a vanilla intent (drop the `schema` field) |
| Xcode 16.0 dyld error like `Symbol not found: _$s10AppIntents15AssistantSchemaV...` | Old Xcode toolchain | Upgrade to Xcode 16.1+ (fix shipped in 16.1 beta 2 / iOS 18.1 beta 4) |
| Schema intent not invoked by Siri voice on simulator | Simulator Siri text input routes differently than real-device voice; no Apple Intelligence on simulator | Test on a physical iPhone 15 Pro+ / 16+ with Apple Intelligence enabled. Library tap path is the reliable signal on simulator |

## 9. Related docs

- [Apple — AssistantSchemas](https://developer.apple.com/documentation/appintents/assistantschemas)
- [Apple — `@AppIntent(schema:)` macro](https://developer.apple.com/documentation/appintents/appintent(schema:))
- [Apple — Integrating actions with Siri and Apple Intelligence](https://developer.apple.com/documentation/appintents/integrating-actions-with-siri-and-apple-intelligence)
- [WWDC24 — Bring your app to Siri](https://developer.apple.com/videos/play/wwdc2024/10133/)
- [WWDC25 — Develop for Shortcuts and Spotlight with App Intents](https://developer.apple.com/videos/play/wwdc2025/260/)
- `runbook/integrate-app-shortcut.md` — the base AppShortcut runbook this one extends
- `plugin/SCOPE.md` — package boundary; AssistantSchemas falls on the *invocation* side
