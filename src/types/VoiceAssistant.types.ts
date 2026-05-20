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

export enum ParameterType {
  STRING = "string",
  NUMBER = "number",
  BOOLEAN = "boolean",
  ENUM = "enum",
  DATE = "date",
  OBJECT = "object",
  ARRAY = "array",
}

export enum PermissionStatus {
  GRANTED = "granted",
  DENIED = "denied",
  UNDETERMINED = "undetermined",
  UNAVAILABLE = "unavailable",
}

/**
 * Minimum shape every AppEntity record must satisfy. `id` is the Swift
 * AppEntity's primary key and must be globally unique within the
 * entity type (iOS treats it as the identity for remembering bound
 * parameter values across sessions). Additional properties matching
 * the declared `ios.entities[].properties` shape are passed through to
 * the generated Swift `<Name>Entity` struct.
 */
export interface EntityRecord {
  id: string;
  [key: string]: unknown;
}

/**
 * Developer-supplied resolver for an AppEntity type. Registered via
 * `VoiceAssistant.registerEntityResolver(typeName, resolver)`. iOS
 * calls one of these three methods at scan time depending on what the
 * system needs:
 *
 *   - `matching(search)` — fuzzy text → entities. Drives Spotlight
 *     autocomplete + Siri voice extraction.
 *   - `resolve(ids)` — id list → entities. Reconciles remembered
 *     parameter values across sessions.
 *   - `suggested()` — proactive picks for "you may want this"
 *     surfaces. Optional; defaults to empty.
 *
 * Each method runs on the JS thread, must respond within ~1 second
 * (the pod-side EntityResolver timeout), and must return at minimum
 * `{ id }` plus every property declared on the entity in `app.json`.
 */
export interface EntityResolver<T extends EntityRecord> {
  matching: (search: string) => Promise<T[]>;
  resolve: (ids: string[]) => Promise<T[]>;
  suggested?: () => Promise<T[]>;
}

export interface VoiceParameter {
  name: string;
  type: ParameterType;
  required?: boolean;
  defaultValue?: any;
  prompt?: string;
  choices?: string[];
  parser?: (value: any) => any;
}

export interface AndroidParameter {
  name: string;
  key: string;
  mimeType?: string;
  required?: boolean;
}

export interface IntentHandler<TParams, TResponse> {
  resolve?: (
    params: Partial<TParams>
  ) => Promise<TParams | { needsValue: string }>;
  handle: (params: TParams, context: IntentContext) => Promise<TResponse>;
  onError?: (error: Error) => Promise<TResponse>;
}

export interface IntentContext {
  platform: "ios" | "android" | "web";
  locale: string;
  userId?: string;
  sessionId: string;
  timestamp: Date;
}

export interface VoiceIntent<
  TParams = Record<string, unknown>,
  TResponse = unknown
> {
  readonly id: string;
  readonly category: IntentCategory;
  readonly parameters: VoiceParameter[];
  readonly handler: IntentHandler<TParams, TResponse>;
  readonly platforms: {
    ios?: {
      siriKitDomain?: string;
      appIntentSchema?: string;
      phrases: string[];
      requiresUnlock?: boolean;
    };
    android?: {
      biiCategory?: string;
      capability: string;
      parameters: AndroidParameter[];
      fulfillment?: "INLINE" | "DEFERRED";
    };
  };
}

export interface PlatformCapabilities {
  ios?: {
    siriKitSupported: boolean;
    appIntentsSupported: boolean;
    availableDomains: string[];
    speechRecognitionAvailable: boolean;
  };
  android?: {
    appActionsSupported: boolean;
    googleAssistantAvailable: boolean;
    voiceAccessSupported: boolean;
    slicesSupported: boolean;
  };
}

export interface VoiceAssistantConfig {
  enableBackgroundExecution?: boolean;
  enableCustomUI?: boolean;
  enableMediaSession?: boolean;
  enableHealthKit?: boolean;
  enableGoogleFit?: boolean;
  debugMode?: boolean;
}

export interface IntentResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  needsDisambiguation?: boolean;
  options?: string[];
}

export interface PermissionManager {
  requestMicrophonePermission(): Promise<PermissionStatus>;
  requestSpeechRecognitionPermission(): Promise<PermissionStatus>;
  checkCapabilities(): Promise<PlatformCapabilities>;
  checkPermissionStatus(permission: string): Promise<PermissionStatus>;
}

/**
 * Public lifecycle events that VoiceAssistant broadcasts to observers via
 * `addEventListener`. Invocation events are NOT part of this union — voice
 * triggers go directly to the registered intent handler (push model).
 * See VoiceAssistant class docstring + AGENTS.md for the rationale.
 */
export interface VoiceEvent {
  type: "onIntentCompleted" | "onIntentFailed";
  intentId: string;
  data?: any;
  error?: Error;
  timestamp: Date;
}

export type VoiceEventListener = (event: VoiceEvent) => void;

export interface SearchFilters {
  dateRange?: {
    from?: Date;
    to?: Date;
  };
  categories?: string[];
  sortBy?: "relevance" | "date" | "name";
  limit?: number;
}

export interface ParameterConfig<T> {
  type: ParameterType;
  required?: boolean;
  defaultValue?: T;
  prompt?: string;
  choices?: T[];
  parser?: (value: any) => T;
  validator?: (value: T) => boolean;
}

export interface IntentRegistration {
  intent: VoiceIntent;
  priority?: number;
  enabled?: boolean;
}
