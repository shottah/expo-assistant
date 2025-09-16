export enum IntentCategory {
  SEARCH = 'search',
  MEDIA = 'media',
  PRODUCTIVITY = 'productivity',
  HEALTH = 'health',
  COMMUNICATION = 'communication',
  TRAVEL = 'travel',
  FINANCE = 'finance',
  COMMERCE = 'commerce',
  CUSTOM = 'custom'
}

export enum ParameterType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  ENUM = 'enum',
  DATE = 'date',
  OBJECT = 'object',
  ARRAY = 'array'
}

export enum PermissionStatus {
  GRANTED = 'granted',
  DENIED = 'denied',
  UNDETERMINED = 'undetermined',
  UNAVAILABLE = 'unavailable'
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
  resolve?: (params: Partial<TParams>) => Promise<TParams | { needsValue: string }>;
  handle: (params: TParams, context: IntentContext) => Promise<TResponse>;
  onError?: (error: Error) => Promise<TResponse>;
}

export interface IntentContext {
  platform: 'ios' | 'android' | 'web';
  locale: string;
  userId?: string;
  sessionId: string;
  timestamp: Date;
}

export interface VoiceIntent<TParams = Record<string, unknown>, TResponse = unknown> {
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
      fulfillment?: 'INLINE' | 'DEFERRED';
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

export interface VoiceEvent {
  type: 'onIntentReceived' | 'onIntentCompleted' | 'onIntentFailed';
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
  sortBy?: 'relevance' | 'date' | 'name';
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