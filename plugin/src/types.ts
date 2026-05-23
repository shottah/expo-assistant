/**
 * Config plugin type definitions for expo-assistant
 */

export enum IntentCategory {
  SEARCH = "search",
  MEDIA = "media",
  PRODUCTIVITY = "productivity",
  HEALTH = "health",
  COMMUNICATION = "communication",
  TRAVEL = "travel",
  FINANCE = "finance",
  COMMERCE = "commerce",
  CUSTOM = "custom",
}

/**
 * One declared parameter on an AppShortcut. The plugin uses this to
 * generate a per-shortcut typed AppIntent Swift struct with a matching
 * `@Parameter` property.
 *
 * Primitive types (`string`, `number`, `boolean`, `date`, `duration`,
 * `length`, `url`) cannot appear as voice phrase slots — Apple's
 * `AppShortcutPhrase` only accepts `AppEntity` / `AppEnum` types. The
 * plugin throws at prebuild if a phrase references a primitive
 * parameter via `${paramName}`.
 *
 * Both `AppEnum`-typed parameters (`type: "enum:Name"` referencing a
 * declared `ios.enums[]` entry) AND `AppEntity`-typed parameters
 * (`type: "entity:Name"` referencing a declared `ios.entities[]`
 * entry) ARE voice-slottable. Use enum for closed-set choices
 * ("cycling" / "running" / "swimming"); use entity for free-form text
 * that resolves against your app's data (a Project name, a Contact, a
 * Tag) — entity values are looked up at scan time through an async
 * resolver you register from JS (see `VoiceAssistant.registerEntityResolver`).
 *
 * `IntentFile` is deferred to its own slice — file handle lifecycle
 * and binary payload bridging deserve dedicated treatment.
 */
export interface AppShortcutParameter {
  /** Identifier used as the Swift property name AND the JS dict key the handler receives. Must be a valid identifier in both. */
  name: string;
  /**
   * Parameter type. Primitives (string/number/boolean) and rich
   * primitives (date/duration/length/url) are filled via
   * `requestValueDialog` prompts only — they are NOT voice-slottable.
   * Enum types in the shape `"enum:<Name>"` reference a declared
   * `ios.enums[]` entry and ARE voice-slottable per Apple's constraint.
   */
  type:
    | "string"
    | "number"
    | "boolean"
    | "date"
    | "duration"
    | "length"
    | "url"
    | `enum:${string}`
    | `entity:${string}`;
  /** Display title used by `@Parameter(title:)`. Defaults to `name` capitalized. */
  title?: string;
  /** Prompt text iOS speaks/shows when the parameter is unbound at invocation time. Used as `requestValueDialog`. */
  prompt?: string;
}

/**
 * A closed-set choice type the plugin generates as a Swift
 * `AppEnum`-conforming struct. Used as the type of an
 * AppShortcutParameter via `type: "enum:<Name>"`. AppEnum is one of
 * the two types Apple's AppShortcutPhrase accepts as voice slots, so
 * phrases like "Start ${kind} workout in ${applicationName}" become
 * legal when `kind` is enum-typed.
 */
export interface AppEnumDeclaration {
  /** Swift type name. Should be a valid Swift identifier (PascalCase by convention). */
  name: string;
  /** Display name used by `TypeDisplayRepresentation`. Defaults to `name`. */
  displayName?: string;
  /** Allowed case values. `id` is the raw Swift case + the value passed to JS; `display` is the human-readable label shown in pickers / spoken by Siri. */
  cases: { id: string; display: string }[];
}

/**
 * One property on a declared AppEntity. Becomes a stored Swift property
 * on the generated `<Name>Entity: AppEntity` struct AND a key the JS
 * side pushes when resolving entities for queries.
 */
export interface AppEntityProperty {
  /** Identifier — must be a valid Swift property name AND a JS dict key. */
  name: string;
  /** Type vocabulary mirrors the AppShortcut primitive set (no nesting). */
  type: "string" | "number" | "boolean";
}

/**
 * A queryable, Siri-aware piece of app data the plugin generates as a
 * Swift `AppEntity`-conforming struct plus an `EntityStringQuery`
 * sibling that bridges back into JS at scan time. Reference an entity
 * type from an `AppShortcutParameter` via `type: "entity:<Name>"`.
 *
 * AppEntity is one of two types Apple's `AppShortcutPhrase` accepts as
 * voice slots (the other is `AppEnum`), so phrases like
 * `"Open ${project} in ${applicationName}"` become legal when
 * `project` is entity-typed. Siri / Spotlight ask the generated
 * `<Name>Query.entities(matching:)` for matches against the user's
 * spoken text; that query proxies into your JS resolver via the
 * `EntityResolver` bridge.
 *
 * `id` is implicit — every AppEntity has an `id: String` per Apple's
 * protocol. JS must supply an `id` on every entity dict pushed back
 * through a resolver.
 *
 * **Resolver lifecycle** (#28 ships approach A — async-with-timeout):
 * the JS resolver is asked synchronously at scan time, with a 1s
 * timeout. If the host app is backgrounded or terminated, JS is not
 * alive and the query falls back to empty results. The snapshot-store
 * follow-up (#41) restores backgrounded scan support.
 */
export interface AppEntityDeclaration {
  /** Swift type name. Should be a valid Swift identifier (PascalCase by convention). The generated struct is named `<name>Entity`. */
  name: string;
  /** Display name used by `TypeDisplayRepresentation`. Defaults to `name`. */
  displayName?: string;
  /**
   * Which declared property to use as the entity's
   * `displayRepresentation` title (shown in Shortcuts pickers, Spotlight
   * autocomplete, spoken back by Siri). Must reference a `string`-typed
   * property declared in `properties`. Defaults to `"title"` if a
   * property of that name exists, otherwise the first string property.
   */
  displayProperty?: string;
  /**
   * Properties on the entity beyond the implicit `id`. Each becomes a
   * stored `@Property`-less Swift `let` on the generated struct AND a
   * key in the dict JS pushes from its resolver. Must declare at least
   * one string property so `displayRepresentation` has a sensible
   * default.
   */
  properties: AppEntityProperty[];
}

export interface ExpoAssistantPluginConfig {
  // Core Features
  enableSiriKit?: boolean;
  enableAppIntents?: boolean;
  enableAppActions?: boolean;
  enableBackgroundExecution?: boolean;
  enableCustomUI?: boolean;
  enableMediaSession?: boolean;
  enableHealthKit?: boolean;
  enableGoogleFit?: boolean;

  // Intent Categories to Enable
  intents?: IntentCategory[];

  // iOS Specific
  ios?: {
    siriUsageDescription?: string;
    alternativeAppNames?: string[];
    intentExtensionBundleId?: string;
    appGroups?: string[];
    supportedIntentTypes?: string[];
    requiresUnlock?: boolean;
    siriKitDomains?: string[];
    appIntentSchemas?: string[];
    /**
     * Voice shortcuts exposed via AppShortcutsProvider (iOS 16+).
     * Each entry becomes a Siri-triggerable shortcut. The plugin
     * generates `ios/AppShortcutsBridge.generated.swift` at prebuild
     * containing the populated AppShortcut list. Each shortcut's
     * `perform()` fires `onIntentInvoked` with the declared `id`,
     * routed by VoiceAssistant to the registered JS handler with
     * matching `intent.id`.
     */
    /**
     * Closed-set enum types referenced by `appShortcuts[].parameters[].type`
     * via the `enum:<Name>` syntax. Each generates a Swift `AppEnum`-
     * conforming struct that becomes voice-slottable in phrases. See
     * `AppEnumDeclaration` for the shape.
     */
    enums?: AppEnumDeclaration[];
    /**
     * Queryable app-data types referenced by `appShortcuts[].parameters[].type`
     * via the `entity:<Name>` syntax. Each generates a Swift
     * `AppEntity`-conforming struct + an `EntityStringQuery` sibling
     * that bridges into the JS resolver registered via
     * `VoiceAssistant.registerEntityResolver(typeName, resolver)`. See
     * `AppEntityDeclaration` for the shape.
     */
    entities?: AppEntityDeclaration[];
    appShortcuts?: {
      id: string;
      title: string;
      phrases?: string[];
      systemImageName?: string;
      /**
       * Declared parameters for the shortcut. When present, the plugin
       * generates a dedicated typed AppIntent Swift struct for this
       * shortcut (instead of routing through the shared
       * GenericVoiceIntent). Each parameter becomes an `@Parameter` on
       * the generated struct; when iOS invokes the shortcut without a
       * bound value, the system prompts the user via `requestValueDialog`
       * (sourced from `prompt`).
       *
       * If omitted, the shortcut continues to route through
       * GenericVoiceIntent for backwards compatibility — a single
       * required `query: String` parameter prompted at runtime.
       *
       * Per Apple's AppShortcutPhrase constraint (see issue #37 +
       * https://developer.apple.com/forums/thread/770037), primitive
       * parameter values (`string`, `number`, `boolean`) CANNOT appear
       * as voice phrase slots — they are only fillable via the
       * `requestValueDialog` prompt or via the Shortcuts editor. The
       * plugin throws at prebuild if a phrase template references a
       * primitive parameter via `${paramName}`.
       *
       * When `schema` is set, the schema's required parameters are
       * AUTO-INJECTED from the catalog — declaring them here will throw
       * at prebuild. Only declare extras beyond what the schema requires.
       */
      parameters?: AppShortcutParameter[];
      /**
       * Optional AssistantSchemas conformance. When set, the plugin
       * emits `@AppIntent(schema: .<schema>)` on the generated struct,
       * automatically wires the schema's required parameters from the
       * catalog, and gates the struct with `@available(iOS 18.0, *)`.
       * Apple's training models can then route to this intent based on
       * semantic intent inference (not just declared phrase templates).
       *
       * Schema-bound intents are additive: they still appear in
       * Shortcuts.app Library, Spotlight, and Siri voice paths —
       * `assistantOnly: true` is the opt-out for AI-only visibility.
       *
       * Known schema IDs (catalog at
       * `plugin/src/ios/codegen/schemas/catalog.ts`): "system.search".
       * Adding new schemas is a catalog-table addition; see Apple's docs
       * at https://developer.apple.com/documentation/appintents/assistantschemas.
       *
       * **iOS 17.4 minimum deployment target** is required if this
       * shortcut is also referenced from `AppShortcutsProvider` (i.e.
       * any `appShortcuts[]` entry with a `schema`) due to a documented
       * Xcode 16.0 dyld bug (fixed in 16.1) and the AppShortcutsBuilder
       * conditional-availability floor. Lower targets warn; do not
       * error.
       */
      schema?: string;
      /**
       * When `true`, emits `static let isAssistantOnly: Bool = true`
       * on the generated struct. The intent vanishes from the
       * Shortcuts.app Library and from Spotlight — it's only available
       * via Apple Intelligence routing. Use during schema-migration
       * scenarios when adding schema conformance to an existing intent
       * would otherwise break users' saved Shortcuts.
       *
       * Only meaningful when `schema` is also set; ignored otherwise.
       *
       * Voice-routing behavior with this flag is unverified on
       * simulator (spike question Q3 deferred to real-device follow-up).
       * Don't rely on Siri voice fallback for assistantOnly intents.
       */
      assistantOnly?: boolean;
    }[];
  };

  // Android Specific
  android?: {
    appActionsTestUrl?: string;
    deepLinkVerification?: boolean;
    voiceInteractionService?: boolean;
    slicesEnabled?: boolean;
    customVocabulary?: {
      terms: {
        value: string;
        synonyms: string[];
      }[];
    };
    biiCategories?: string[];
    capabilities?: string[];
  };

  // Development
  debugMode?: boolean;
}

// Intent type mappings
export const INTENT_TYPE_MAPPINGS: {
  ios: Record<string, string[]>;
  android: Record<string, string[]>;
} = {
  ios: {
    [IntentCategory.SEARCH]: [
      "INSearchIntent",
      "INSearchForMessagesIntent",
      "INSearchForNotesIntent",
    ],
    [IntentCategory.MEDIA]: [
      "INPlayMediaIntent",
      "INPauseMediaIntent",
      "INSearchForMediaIntent",
    ],
    [IntentCategory.PRODUCTIVITY]: [
      "INCreateTaskIntent",
      "INCreateNoteIntent",
      "INAddTasksIntent",
    ],
    [IntentCategory.HEALTH]: [
      "INStartWorkoutIntent",
      "INEndWorkoutIntent",
      "INPauseWorkoutIntent",
    ],
    [IntentCategory.COMMUNICATION]: [
      "INSendMessageIntent",
      "INStartCallIntent",
      "INSearchForMessagesIntent",
    ],
    [IntentCategory.TRAVEL]: [
      "INBookRestaurantReservationIntent",
      "INGetRideStatusIntent",
      "INRequestRideIntent",
    ],
    [IntentCategory.FINANCE]: [
      "INSendPaymentIntent",
      "INRequestPaymentIntent",
      "INTransferMoneyIntent",
    ],
    [IntentCategory.COMMERCE]: [
      "INSearchForProductsIntent",
      "INOrderProductIntent",
      "INGetOrderStatusIntent",
    ],
  },
  android: {
    [IntentCategory.SEARCH]: [
      "actions.intent.GET_THING",
      "actions.intent.SEARCH",
    ],
    [IntentCategory.MEDIA]: [
      "actions.intent.PLAY_MEDIA",
      "actions.intent.PAUSE_MEDIA",
    ],
    [IntentCategory.PRODUCTIVITY]: [
      "actions.intent.CREATE_THING",
      "actions.intent.CREATE_TASK_LIST",
    ],
    [IntentCategory.HEALTH]: [
      "actions.intent.START_EXERCISE",
      "actions.intent.STOP_EXERCISE",
    ],
    [IntentCategory.COMMUNICATION]: [
      "actions.intent.SEND_MESSAGE",
      "actions.intent.CALL",
    ],
    [IntentCategory.TRAVEL]: [
      "actions.intent.GET_RIDE",
      "actions.intent.GET_RESERVATION",
      "actions.intent.BOOK_RIDE",
    ],
    [IntentCategory.FINANCE]: [
      "actions.intent.SEND_MONEY",
      "actions.intent.PAY_BILL",
      "actions.intent.CHECK_BALANCE",
    ],
    [IntentCategory.COMMERCE]: [
      "actions.intent.ORDER_ITEM",
      "actions.intent.GET_ORDER",
      "actions.intent.ADD_TO_CART",
    ],
  },
};
