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
