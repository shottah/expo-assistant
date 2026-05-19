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
 */
export interface AppShortcutParameter {
  /** Identifier used as the Swift property name AND the JS dict key the handler receives. Must be a valid identifier in both. */
  name: string;
  /** Initial supported primitive types. Entity/enum types are #28/#29. */
  type: "string" | "number" | "boolean";
  /** Display title used by `@Parameter(title:)`. Defaults to `name` capitalized. */
  title?: string;
  /** Prompt text iOS speaks/shows when the parameter is unbound at invocation time. Used as `requestValueDialog`. */
  prompt?: string;
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
       */
      parameters?: AppShortcutParameter[];
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
