# Plugin maintenance guide

Guidance for agents and human contributors extending the config plugin. **Read this before adding a new mod, a new codegen module, or modifying the generated Swift surface.**

This doc lives at `plugin/AGENTS.md`. The repo-root `AGENTS.md` covers the broader package architecture (the three-flow register/donate/invoke matrix, push-only invocation model, cross-platform contract); this doc covers everything specific to how the config plugin is constructed and how to evolve it.

The shape of the plugin was established by the audit at `.plan/07-plugin-audit.md` (gitignored, local-only) and codified by the refactor in PR #46. Follow the patterns below — they're not arbitrary, they line up with the conventions in eight first-party Expo plugins we reviewed.

---

## 1. File layout

```
plugin/src/
  index.ts                          # top-level: composer + createRunOncePlugin wrap
  types.ts                          # ExpoAssistantPluginConfig + all AppShortcut*/AppEnum*/AppEntity* shapes
  utils/
    errors.ts                       # pluginError({what,why,how}) — the only sanctioned throw helper
  ios/
    index.ts                        # iOS composer — thin sequence of with*.ts mods
    withIOSInfoPlist.ts             # one mod, one concern (Info.plist mutations)
    withIOSEntitlements.ts          # one mod, one concern (entitlements)
    withIOSAppShortcutsCodegen.ts   # withXcodeProject mod: validates refs, generates swift, registers in pbxproj
    withIOSIntentExtension.ts       # legacy SiriKit IntentExtension scaffolder (gated, pre-iOS 16)
    codegen/                        # PURE FUNCTIONS — no fs, no mod plumbing, directly unit-testable
      types.ts                      # swiftTypeFor, marshalExpr, intentStructName, isEnumType, isEntityType, escapeSwift, capitalize
      PhraseLiteral.ts              # buildPhraseLiteral + slot validation
      AppEnumSwift.ts               # generateAppEnumStruct
      AppEntitySwift.ts             # generateAppEntityStructs + entity prop helpers
      TypedIntentSwift.ts           # generateTypedIntentStruct
      AppShortcutsProviderSwift.ts  # renderAppShortcutsProviderFile (top-level file assembly) + buildAppleRefBlock
  withAndroidVoiceIntents.ts        # Android side — still monolithic, refactor tracked separately
```

### The two layers

- **`with*.ts` mod files** are the side-effect layer. Each wraps a single `@expo/config-plugins` helper (`withInfoPlist`, `withEntitlementsPlist`, `withXcodeProject`, etc.) and orchestrates one concern. They own fs writes, pbxproj mutations, and the `@expo` mod context.
- **`codegen/` is the pure layer.** Every file here exports functions that take in declarations and return Swift source strings. No fs, no mod plumbing, no side effects. Directly callable from tests without a stub harness.

When you add a feature, **figure out which layer it belongs in first.** Code that produces Swift text → `codegen/`. Code that touches Xcode / Info.plist / entitlements → a new or existing `with*.ts` mod.

---

## 2. Adding a new feature

### Common case: a new declarative slice (issues #30, #32, #33, #34)

The roadmap has several "add a new intent class type" features queued — Apple Intelligence schema conformance (#30), `AudioPlaybackIntent` (#32), `WidgetConfigurationIntent` (#33), `ControlConfigurationIntent` (#34). Each follows the same pattern:

1. **Extend `plugin/src/types.ts`** with the new declaration shape. Document it via JSDoc — `Information about when to use this and when not to`. Add the new `type` value to the `AppShortcutParameter.type` union if it's a new parameter kind.
2. **Add a new pure codegen file under `plugin/src/ios/codegen/`** that generates the Swift for the new declaration. Example: `AudioPlaybackIntentSwift.ts` exports `generateAudioPlaybackIntent(decl)`. Follow the shape of `TypedIntentSwift.ts` — header docstring explaining what it generates and why, validation up-front via `pluginError`, then the template string.
3. **If the new declaration needs cross-reference validation** (e.g. parameter references entity), add the check inside `withIOSAppShortcutsCodegen.ts → validateCrossReferences`, NOT inside the codegen module. Codegen modules trust their inputs; validation lives in the mod.
4. **Wire the new generator into `renderAppShortcutsProviderFile`** in `codegen/AppShortcutsProviderSwift.ts`. That's the single function that assembles the final swift output. Add a new block (`audioBlock`, etc.) and slot it into the swift template.
5. **Add tests in `plugin/__tests__/withExpoAssistant.test.ts`** following the existing pattern. Use `applyPlugin(...).runIosAppShortcutsCodegen(tmpRoot)` to invoke the mod and assert on the generated swift text via `readGenerated()`.
6. **Update the Apple-doc URL block** in `buildAppleRefBlock` so the generated file's header cites the relevant Apple docs conditionally.
7. **If the feature touches Info.plist or entitlements**, add to `setInfoPlist` or `setEntitlements` — don't create a new mod for "just one Info.plist key", but DO create a new mod if you're adding a meaningfully different concern (e.g. App Group container provisioning for #41 snapshot-store).

### When to add a new `with*.ts` mod

Add a new mod when:
- You need a different `@expo/config-plugins` helper than any existing mod uses (e.g. `withDangerousMod`, `withAndroidColorsXml`, `withGradleProperties`).
- The new concern is genuinely orthogonal to existing concerns — e.g. a new mod for App Group entitlement when #41 ships, distinct from `withIOSEntitlements`.

Don't add a new mod just to organize code that fits an existing concern. `withIOSInfoPlist` should hold ALL Info.plist mutations the package owns. Splitting "info plist for siri usage" from "info plist for background modes" would be over-decomposed.

### When to add a new `codegen/` file

Add a new file when:
- The new generator produces a self-contained Swift declaration (a new struct kind, a new file kind).
- The generator's complexity warrants > ~30 lines.

Don't add a new file for a single helper function — extend `codegen/types.ts` (the shared low-level helpers).

---

## 3. Conventions (these are not optional)

### `pluginError({what, why, how})` for ALL throws

Every thrown error in plugin code goes through `pluginError` from `plugin/src/utils/errors.ts`. The shape matches Expo's official internal convention (see `~/Github/expo/.claude/CLAUDE.md`):

- **what**: clearly state what failed. e.g. `entity name "1Bad" is not a valid Swift identifier`
- **why**: explain the underlying constraint at the developer's abstraction. e.g. `Swift type names must start with a letter or underscore...`
- **how**: tell the developer what to do next. e.g. `Rename the entity to a valid Swift identifier (PascalCase by convention)...`

The `[expo-assistant]` prefix is mandatory — the test harness (`plugin/__tests__/withExpoAssistant.test.ts:116-118`) keys off it to decide which throws to propagate vs swallow during stub-harness invocations.

```typescript
import { pluginError } from "../../utils/errors";

throw pluginError({
  what: `enum "${decl.name}" must declare at least one case`,
  why: "An empty AppEnum has no possible values, so Siri/Shortcuts can't surface it as a picker option.",
  how: `Add at least one { id, display } entry to the "${decl.name}" enum's cases array.`,
});
```

**Don't `throw new Error("...")` directly.** That bypasses the structure and produces single-line messages developers can't act on.

### Swift identifier validation: shared regex

Use the inline regex `/^[A-Za-z_][A-Za-z0-9_]*$/` (capture as `SWIFT_IDENT` if reused multiple times in a file). Validate identifiers up-front in the codegen module before building strings.

**Forward-looking:** expo-widgets uses `assertSwiftIdentifier(value, label): asserts value is string` for type-narrowing TS assertions — cleaner than scattered `.test()` calls. Worth refactoring to once we have 5+ identifier-validation sites.

### pbxproj idempotency: `project.hasFile()`, not string-scanning

```typescript
if (!project.hasFile(filepathInGroup)) {
  IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: filepathInGroup, groupName, project });
}
```

NEVER `JSON.stringify(project.hash).includes(...)`. That was the pre-refactor pattern; it's fragile, slow, and breaks on upgrades. Reference: `~/Github/expo/packages/expo-notifications/plugin/src/withNotificationsIOS.ts:102-108`.

### `createRunOncePlugin` for the top-level export

`plugin/src/index.ts` already wraps the default export. Universal first-party convention. Don't strip it.

For sub-mod-specific run-once needs (e.g. when #41 snapshot-store needs to push entities to App Group container exactly once even if the plugin composes multiple times), use `History.getHistoryItem('expo-assistant-<sub-feature>-once')` directly — pattern from `expo-build-properties/src/android.ts:153-198`.

### Swift string escaping: `escapeSwift` for most cases

`escapeSwift(s)` from `codegen/types.ts` doubles backslashes and escapes double quotes. Use it for any string you embed in Swift literals.

**Don't `escapeSwift` raw Swift interpolation syntax** like `\(.applicationName)` or `\(\.$query)` — those backslashes are compile-time Swift syntax, not runtime characters. Build literals via the parts-array pattern in `PhraseLiteral.ts:60-78` where plain text segments go through `escapeSwift` but interpolation tokens are concatenated raw.

`JSON.stringify(s)` works for many cases as a stand-in for `escapeSwift` because Swift accepts JSON-like literal syntax — expo-widgets uses this. We don't, because it's less obvious to readers and doesn't cover our interpolation case.

---

## 4. Test conventions

Tests live in `plugin/__tests__/withExpoAssistant.test.ts` (single file, organized by describe blocks per mod / per feature).

### The harness

`applyPlugin(config, props)` returns an object with `runInfoPlist`, `runEntitlements`, `runAndroidManifest`, `runIosAppShortcutsCodegen` methods. Each picks the corresponding mod off `result.mods.ios.*` / `result.mods.android.*` and invokes it against a stub `modResults` + `modRequest`.

For `runIosAppShortcutsCodegen`, the harness:
1. Provides a minimal pbxproj stub (just enough to satisfy `addBuildSourceFileToGroup`'s internal calls).
2. Invokes the mod.
3. Catches any errors. **Throws that start with `[expo-assistant]` propagate** (so test assertions can match on them). Other throws (stub-incompatibility from xcodeparser internals) are swallowed.

After invocation, `readGenerated()` reads the generated swift from the tmpRoot the harness set up. Tests assert via `expect(swift).toContain(...)` or rejection patterns via `expect(...).rejects.toThrow(/.../)`.

### Adding tests for a new codegen module

1. Add a new `describe` block in `withExpoAssistant.test.ts` for the new feature.
2. Test the happy path: `applyPlugin(baseConfig(), { ios: { ... } }).runIosAppShortcutsCodegen(tmpRoot)` then assert the swift contains the expected struct/case/property.
3. Test each validation throw: `expect(applyPlugin(...).runIosAppShortcutsCodegen(...)).rejects.toThrow(/pattern/)`. Match on a unique substring from the `what` field of your `pluginError`.
4. Test the conditional Apple-doc URL inclusion if the feature surfaces new types.

Codegen functions are pure — you can also unit-test them directly without the mod harness:

```typescript
import { generateAppEnumStruct } from "../src/ios/codegen/AppEnumSwift";

it("generates a basic enum struct", () => {
  const swift = generateAppEnumStruct({
    name: "Mode",
    cases: [{ id: "a", display: "A" }],
  });
  expect(swift).toContain("public enum Mode: String, AppEnum");
});
```

Direct unit tests are encouraged for new generators. Use them to cover edge cases that would be awkward to set up through the full mod harness.

---

## 5. First-party precedents we follow

When in doubt, read these files:

| Reference | What to learn |
|---|---|
| `~/Github/expo/packages/expo-widgets/plugin/src/withWidgetSourceFiles.ts` | **Closest analog to our generators** — generates `WidgetConfigurationIntent` Swift structs per declared widget with @Parameter declarations and AppEnum codegen. Pattern matches `TypedIntentSwift.ts` + `AppEnumSwift.ts` almost 1:1. |
| `~/Github/expo/packages/expo-splash-screen/plugin/src/` | **Mod factoring reference** — 17 files in src/, each one mod or one helper. Matches our ios/ split. |
| `~/Github/expo/packages/expo-notifications/plugin/src/withNotificationsIOS.ts:102-108` | pbxproj `hasFile()` idempotency pattern (what we now use). |
| `~/Github/expo/packages/expo-tracking-transparency/plugin/src/withTrackingTransparency.ts:31` | `createRunOncePlugin` baseline. |
| `~/Github/expo/packages/expo-build-properties/src/withBuildProperties.ts` | Thin composer + per-feature mods pattern. Also the canonical example of sub-mod-specific `History.addHistoryItem` for fine-grained run-once. |
| `~/Github/expo/packages/expo-build-properties/src/android.ts:153-198` | `withAndroidPurgeProguardRulesOnce` — what to do when ONE sub-mod needs run-once but the rest of the plugin should run every composition. |
| `~/Github/expo/packages/@expo/config-plugins/src/utils/generateCode.ts:35-66` | `mergeContents` helper — use this for any future inserts into shared files (Podfile additions, AppDelegate hooks). Tagged blocks with content hashes; survives manual edits outside the block. |
| `~/Github/expo/packages/@expo/config-plugins/src/utils/warnings.ts:16-33` | `addWarningIOS` / `addWarningAndroid` for non-fatal warnings. Backfill these in place of `console.warn` if you have soft warnings to emit. |
| `~/Github/expo/.claude/CLAUDE.md` | Source of the what/why/how error message convention. |

The audit at `.plan/07-plugin-audit.md` covers all ten conventions in detail with file:line citations. Consult it when picking patterns for new work.

---

## 6. Cross-references

- **Repo-root `AGENTS.md`** — package-level architecture (register/donate/invoke matrix, push-only invocation model, cross-platform contract, native module conventions).
- **`runbook/integrate-app-shortcut.md`** — developer-facing integration guide. Keep in sync when changing the public surface of the plugin (especially `ios.appShortcuts[]`, `ios.enums[]`, `ios.entities[]`, parameter type vocabulary, phrase rules).
- **`.plan/07-plugin-audit.md`** — the audit that established this structure. Gitignored, local-only. If you bring in a new pattern from a first-party plugin, add a note to the audit's decision log.
- **Issue #42** — the audit tracking issue. Has the running list of follow-up issues (some already shipped via PR #46, others queued).

---

## 7. Things NOT to do

- **Don't grow `withIOSAppShortcutsCodegen.ts` past ~200 lines.** If it's getting big, the new logic likely belongs in a `codegen/` file as pure functions and the mod just calls them.
- **Don't put fs writes or mod plumbing in `codegen/` files.** That layer is pure functions. Side effects break the unit-testability and the "one concern per file" rule.
- **Don't `throw new Error("plain text")`.** Use `pluginError({what, why, how})`. The `[expo-assistant]` prefix and the structured format aren't optional.
- **Don't `JSON.stringify(project.hash).includes(...)` to check for prior pbxproj registration.** Use `project.hasFile(filepathInGroup)`. The string-scan was fragile and is gone for a reason.
- **Don't write conditional logic into the Swift template strings via deeply nested template interpolation.** If a generator gets too gnarly, refactor the logic out into a helper function on the codegen module that takes structured input and returns a string.
- **Don't reintroduce a single mega-file for iOS.** If multiple mods grow and you're tempted to consolidate "to reduce file count" — don't. The audit's keystone recommendation was the split; reverting it hurts every future feature.
- **Don't change the test harness's mod-picking logic** (`result.mods?.ios?.xcodeproj`) unless you also adapt every test. The harness assumes ONE xcodeproj mod per plugin invocation; the legacy IntentExtension mod is gated to skip in normal test runs.
- **Don't add Android codegen patterns until the Android refactor lands.** `withAndroidVoiceIntents.ts` is still the pre-refactor monolithic shape; trying to evolve Android codegen in parallel with the iOS refactor would re-create the original problem on the Android side. Wait for the Android mirror PR (audit follow-up #6).

---

## 8. When you've done something the audit didn't anticipate

The audit at `.plan/07-plugin-audit.md` made decisions based on the state of the package at audit time. If you hit a case it didn't cover (a new Apple framework, a new pattern from a first-party plugin, a constraint we didn't know about), do these in order:

1. **Document the new pattern.** Add a section to this file or a comment in the relevant codegen module. Cite the first-party precedent if applicable.
2. **Update the audit's decision log.** New deviations or new conventions belong there so future contributors see the trail.
3. **If it's a meaningful structural change**, file a new audit follow-up issue so the next refactor PR carries it. Don't slip large structural changes into feature PRs unannounced.
