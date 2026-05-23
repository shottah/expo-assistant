/**
 * AssistantSchemas catalog — hand-maintained table of Apple's
 * `@AppIntent(schema:)` schemas with their required Swift surface.
 *
 * Apple ships no public manifest for schemas (verified during research,
 * `.plan/08-assistant-schemas-research.md` § D3). The Swift compiler is
 * the authoritative validator; this TS table is a prebuild *preflight*
 * that catches the common errors (missing required parameter, wrong
 * parameter name, duplicate schema across shortcuts) with a friendly
 * message before xcodebuild surfaces a cryptic one.
 *
 * Per-iOS-release maintenance: refresh by running the
 * `scripts/refresh-schemas.mjs` scraper against Apple's docs JSON
 * (developer.apple.com/tutorials/data/...) and diffing against the
 * committed table. Apple has not removed schemas; additions show up at
 * each WWDC.
 *
 * Spike findings baked into this catalog:
 * - `system.search.criteria` is `StringSearchCriteria`, NOT bare `String`.
 *   The bare `String` form Stream B's research suggested doesn't compile
 *   (verified 2026-05-21, Xcode 26.2). See spike finding A.
 * - Per-schema-id uniqueness is a binary linker constraint, not just a
 *   macro one — `validate.ts` enforces it before xcodebuild does (spike
 *   finding H).
 *
 * First-cut scope: only `system.search` is fully populated. Other
 * schemas (`photos.openAsset`, `journal.createEntry`, etc.) land in
 * follow-up PRs. The shape of this catalog is the contract; expanding
 * it is mechanical data entry, not architecture.
 */

/**
 * A required parameter on a schema intent. Name and Swift type must
 * match Apple's documented contract — the trained models reference them
 * by name + the Swift compiler enforces the type.
 */
export interface SchemaParameterSpec {
  /** Parameter name as Apple declares it — case-sensitive, must match exactly. */
  name: string;
  /** Swift type as it appears in the generated `var name: <type>` line. May be an Apple framework type like `StringSearchCriteria`. */
  swiftType: string;
  /** Optional default value as a Swift expression string. When absent the parameter is non-optional. */
  defaultValue?: string;
}

/**
 * A static class-level property the schema requires or recommends —
 * e.g. `static var searchScopes: [StringSearchScope]` for `system.search`.
 * The plugin emits these verbatim alongside `perform()`.
 */
export interface SchemaStaticDeclaration {
  /** Full Swift declaration line, e.g. `static var searchScopes: [StringSearchScope] = [.general]`. */
  declaration: string;
}

/** Specifies what `perform()` returns for a given schema. */
export type SchemaReturnType =
  | { kind: "intentResult" }
  | { kind: "intentResultAndReturnsValue"; swiftValueType: string };

/**
 * A complete schema specification. Drives both prebuild validation
 * (does the developer's `appShortcuts[]` entry match this shape?) and
 * Swift codegen (what Swift do we emit?).
 */
export interface SchemaIntentSpec {
  /** Schema dot-path used as the key — e.g. "system.search". */
  schemaId: string;
  /** Swift dot-path used in `@AppIntent(schema:)` — e.g. ".system.search". */
  schemaDotPath: string;
  /** Required protocol conformance beyond AppIntent — e.g. "ShowInAppSearchResultsIntent". */
  conformingProtocol: string;
  /** Parameters Apple requires. The plugin throws if any is missing or mistyped. */
  requiredParams: SchemaParameterSpec[];
  /** Parameters Apple optionally accepts — developer can include or omit. Codegen passes them through if declared. */
  optionalParams: SchemaParameterSpec[];
  /** Static declarations the schema requires (e.g. searchScopes for system.search). */
  staticDeclarations?: SchemaStaticDeclaration[];
  /** Return type of perform(). */
  returnType: SchemaReturnType;
  /** Minimum iOS version this schema's macro requires — drives the @available attribute. */
  minIOS: string;
}

/**
 * The catalog. Keyed by schemaId. To add a new schema, append an entry
 * here, add a runbook section documenting it, and add tests under the
 * "AssistantSchemas codegen" describe block in
 * `plugin/__tests__/withExpoAssistant.test.ts`.
 */
export const INTENT_SCHEMAS: Record<string, SchemaIntentSpec> = {
  "system.search": {
    schemaId: "system.search",
    schemaDotPath: ".system.search",
    conformingProtocol: "ShowInAppSearchResultsIntent",
    requiredParams: [
      {
        name: "criteria",
        swiftType: "StringSearchCriteria",
      },
    ],
    optionalParams: [],
    staticDeclarations: [
      {
        declaration:
          "public static var searchScopes: [StringSearchScope] = [.general]",
      },
    ],
    returnType: { kind: "intentResult" },
    minIOS: "18.0",
  },
};

/**
 * Returns true if the given string is a known schema ID.
 */
export function isKnownSchemaId(schemaId: string): boolean {
  return Object.prototype.hasOwnProperty.call(INTENT_SCHEMAS, schemaId);
}

/**
 * Returns the full set of known schema IDs — used in error messages
 * to point developers at what they could have meant.
 */
export function knownSchemaIds(): string[] {
  return Object.keys(INTENT_SCHEMAS);
}

/**
 * Looks up a schema spec by its dot-path ID. Returns `undefined` for
 * unknown schemas — caller is responsible for surfacing a `pluginError`.
 */
export function getSchemaSpec(schemaId: string): SchemaIntentSpec | undefined {
  return INTENT_SCHEMAS[schemaId];
}
