import ExpoAssistantModule from "./ExpoAssistantModule";
import {
  VoiceIntent,
  VoiceAssistantConfig,
  PlatformCapabilities,
  PermissionStatus,
  IntentRegistration,
  VoiceEvent,
  VoiceEventListener,
  IntentResponse,
} from "./types/VoiceAssistant.types";

export class VoiceAssistant {
  private static instance: VoiceAssistant | null = null;
  private config: VoiceAssistantConfig = {};
  private registeredIntents: Map<string, IntentRegistration> = new Map();
  private eventListeners: Map<string, VoiceEventListener[]> = new Map();
  private initialized = false;

  private constructor(config?: VoiceAssistantConfig) {
    if (config) {
      this.config = config;
    }
  }

  static async initialize(
    config?: VoiceAssistantConfig
  ): Promise<VoiceAssistant> {
    if (!VoiceAssistant.instance) {
      VoiceAssistant.instance = new VoiceAssistant(config);
      await VoiceAssistant.instance.setup();
    }
    return VoiceAssistant.instance;
  }

  private async setup(): Promise<void> {
    try {
      await ExpoAssistantModule.initialize(this.config);
      this.setupEventListeners();
      this.initialized = true;
    } catch (error) {
      console.error("Failed to initialize VoiceAssistant:", error);
      throw error;
    }
  }

  private setupEventListeners(): void {
    ExpoAssistantModule.addListener(
      "onIntentReceived",
      this.handleIntentReceived.bind(this)
    );
    ExpoAssistantModule.addListener(
      "onIntentCompleted",
      this.handleIntentCompleted.bind(this)
    );
    ExpoAssistantModule.addListener(
      "onIntentFailed",
      this.handleIntentFailed.bind(this)
    );
    // Voice-triggered invocation from Siri / Google Assistant — routes
    // back to the user-registered handler via executeIntent, which
    // already wraps resolver / handler / onError.
    ExpoAssistantModule.addListener(
      "onIntentInvoked",
      this.handleIntentInvoked.bind(this)
    );
  }

  private handleIntentInvoked(event: {
    intentId: string;
    parameters: Record<string, unknown>;
  }): void {
    if (!this.registeredIntents.has(event.intentId)) {
      // Unknown intent — emission from a stale donation or another
      // session. Silently ignore so the JS layer doesn't crash on
      // surprise events.
      return;
    }
    void this.executeIntent(event.intentId, event.parameters).catch((err) => {
      console.error(
        `expo-assistant: handler for ${event.intentId} threw during invocation`,
        err
      );
    });
  }

  private handleIntentReceived(event: any): void {
    const intentId = event.intentId;
    const registration = this.registeredIntents.get(intentId);

    if (registration && registration.enabled !== false) {
      this.emitEvent({
        type: "onIntentReceived",
        intentId,
        data: event.data,
        timestamp: new Date(),
      });
    }
  }

  private handleIntentCompleted(event: any): void {
    this.emitEvent({
      type: "onIntentCompleted",
      intentId: event.intentId,
      data: event.data,
      timestamp: new Date(),
    });
  }

  private handleIntentFailed(event: any): void {
    this.emitEvent({
      type: "onIntentFailed",
      intentId: event.intentId,
      error: event.error,
      timestamp: new Date(),
    });
  }

  private emitEvent(event: VoiceEvent): void {
    const listeners = this.eventListeners.get(event.type) || [];
    listeners.forEach((listener) => listener(event));
  }

  async registerIntent<TParams = any, TResponse = any>(
    intent: VoiceIntent<TParams, TResponse>,
    options?: { priority?: number; enabled?: boolean }
  ): Promise<void> {
    if (!this.initialized) {
      throw new Error("VoiceAssistant not initialized");
    }

    const registration: IntentRegistration = {
      intent: intent as VoiceIntent,
      priority: options?.priority || 0,
      enabled: options?.enabled !== false,
    };

    this.registeredIntents.set(intent.id, registration);

    try {
      await ExpoAssistantModule.registerIntent({
        id: intent.id,
        category: intent.category,
        parameters: intent.parameters,
        platforms: intent.platforms,
      });
    } catch (error) {
      this.registeredIntents.delete(intent.id);
      throw error;
    }
  }

  async registerIntents(intents: VoiceIntent[]): Promise<void> {
    for (const intent of intents) {
      await this.registerIntent(intent);
    }
  }

  async unregisterIntent(intentId: string): Promise<void> {
    if (!this.registeredIntents.has(intentId)) {
      throw new Error(`Intent ${intentId} not registered`);
    }

    await ExpoAssistantModule.unregisterIntent(intentId);
    this.registeredIntents.delete(intentId);
  }

  async donateIntent(
    intentId: string,
    parameters: Record<string, any>
  ): Promise<void> {
    if (!this.registeredIntents.has(intentId)) {
      throw new Error(`Intent ${intentId} not registered`);
    }

    await ExpoAssistantModule.donateIntent(intentId, parameters);
  }

  async executeIntent<TParams = any, TResponse = any>(
    intentId: string,
    parameters: TParams
  ): Promise<IntentResponse<TResponse>> {
    const registration = this.registeredIntents.get(intentId);

    if (!registration) {
      throw new Error(`Intent ${intentId} not registered`);
    }

    const intent = registration.intent as VoiceIntent<TParams, TResponse>;

    try {
      const context = await this.createIntentContext();

      let resolvedParams = parameters;
      if (intent.handler.resolve) {
        const resolved = await intent.handler.resolve(parameters);
        if (
          resolved &&
          typeof resolved === "object" &&
          "needsValue" in resolved
        ) {
          const disambiguationResult = resolved as { needsValue: string };
          return {
            success: false,
            needsDisambiguation: true,
            message: `Need value for: ${disambiguationResult.needsValue}`,
          };
        }
        resolvedParams = resolved as TParams;
      }

      const result = await intent.handler.handle(resolvedParams, context);

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      if (intent.handler.onError) {
        const errorResult = await intent.handler.onError(error as Error);
        return {
          success: false,
          data: errorResult,
          error: (error as Error).message,
        };
      }

      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private async createIntentContext() {
    const platform = await ExpoAssistantModule.getPlatform();
    const locale = await ExpoAssistantModule.getLocale();

    return {
      platform,
      locale,
      sessionId: this.generateSessionId(),
      timestamp: new Date(),
    };
  }

  private generateSessionId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }

  async requestMicrophonePermission(): Promise<PermissionStatus> {
    return ExpoAssistantModule.requestMicrophonePermission();
  }

  async requestSpeechRecognitionPermission(): Promise<PermissionStatus> {
    return ExpoAssistantModule.requestSpeechRecognitionPermission();
  }

  async checkCapabilities(): Promise<PlatformCapabilities> {
    return ExpoAssistantModule.checkCapabilities();
  }

  async enableSiriKit(): Promise<void> {
    if (!this.config.enableBackgroundExecution) {
      this.config.enableBackgroundExecution = true;
    }
    await ExpoAssistantModule.enableSiriKit();
  }

  async enableAppActions(): Promise<void> {
    if (!this.config.enableBackgroundExecution) {
      this.config.enableBackgroundExecution = true;
    }
    await ExpoAssistantModule.enableAppActions();
  }

  async enableBackgroundProcessing(): Promise<void> {
    this.config.enableBackgroundExecution = true;
    await ExpoAssistantModule.enableBackgroundProcessing();
  }

  async enableCustomUI(): Promise<void> {
    this.config.enableCustomUI = true;
    await ExpoAssistantModule.enableCustomUI();
  }

  addEventListener(
    event: VoiceEvent["type"],
    listener: VoiceEventListener
  ): () => void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, []);
    }

    const listeners = this.eventListeners.get(event)!;
    listeners.push(listener);

    return () => {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }

  removeEventListener(
    event: VoiceEvent["type"],
    listener: VoiceEventListener
  ): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  getRegisteredIntents(): IntentRegistration[] {
    return Array.from(this.registeredIntents.values());
  }

  async setDebugMode(enabled: boolean): Promise<void> {
    this.config.debugMode = enabled;
    await ExpoAssistantModule.setDebugMode(enabled);
  }
}

export default VoiceAssistant;
