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

/**
 * VoiceAssistant — singleton orchestrator for voice-intent registration,
 * donation, and invocation across iOS and Android.
 *
 * ## Push-only invocation model
 *
 * When the OS fires a registered intent (Siri voice command, Google
 * Assistant App Action, App Shortcut tap), the JS layer routes the
 * invocation directly to the user's registered intent handler — the
 * `handler.handle()` function declared via `VoiceIntentBuilder.withHandler`.
 * There is exactly one handler per intent.
 *
 * Invocation events do NOT fan out through the observer bus
 * (`addEventListener`). The two reasons:
 *
 * 1. Native platforms are inherently push — iOS `AppIntent.perform()` and
 *    Android intent-filter routing both deliver each invocation to exactly
 *    one component. A subscription model would invent semantics neither
 *    platform supports.
 * 2. Two consumer paths for the same event creates ambiguity — "is the
 *    handler authoritative or are observers?" — that no code can answer.
 *
 * Apps that want cross-cutting concerns (logging, analytics, metrics)
 * around invocations should wrap handlers with middleware (higher-order
 * functions on `IntentHandler`), not subscribe via a parallel bus.
 *
 * ## Observer bus (addEventListener)
 *
 * The observer bus IS appropriate for **system / lifecycle events** that
 * don't have a natural handler home:
 *
 * - `onIntentCompleted` — fired after a handler returns successfully
 * - `onIntentFailed` — fired after a handler throws / rejects
 *
 * These are JS-broadcast notifications, useful for decoupled UI updates,
 * analytics, and audits. Apps subscribe via
 * `voiceAssistant.addEventListener("onIntentCompleted", cb)`.
 *
 * See AGENTS.md at the repo root for the broader architecture notes and
 * the register/donate/invoke matrix.
 */
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

  /**
   * Construct the singleton and complete native bridge setup. Safe to
   * call concurrently — a failed initialization does NOT cache the
   * broken instance, so a subsequent call will retry from scratch
   * instead of returning a half-built singleton.
   */
  static async initialize(
    config?: VoiceAssistantConfig
  ): Promise<VoiceAssistant> {
    if (VoiceAssistant.instance) {
      return VoiceAssistant.instance;
    }

    const instance = new VoiceAssistant(config);
    try {
      await ExpoAssistantModule.initialize(instance.config);
      instance.setupEventListeners();
      instance.initialized = true;
    } catch (error) {
      console.error("Failed to initialize VoiceAssistant:", error);
      throw error;
    }

    VoiceAssistant.instance = instance;
    return instance;
  }

  private setupEventListeners(): void {
    // Voice-triggered invocation from Siri / Google Assistant routes
    // directly to the registered intent handler — push model. See class
    // docstring for why invocation does NOT fan out through the observer
    // bus.
    ExpoAssistantModule.addListener(
      "onIntentInvoked",
      this.handleIntentInvoked.bind(this)
    );
    // Completed / Failed are lifecycle status events for the observer bus.
    // Apps subscribe via addEventListener; these may be JS-fired after a
    // handler returns or rejects.
    ExpoAssistantModule.addListener(
      "onIntentCompleted",
      this.handleIntentCompleted.bind(this)
    );
    ExpoAssistantModule.addListener(
      "onIntentFailed",
      this.handleIntentFailed.bind(this)
    );
  }

  /**
   * Push-only invocation handler. Looks up the registered intent and
   * dispatches to its handler.handle() via executeIntent (which wraps
   * the resolver / handle / onError flow). Does NOT broadcast to
   * observers — invocation events are not part of the public
   * addEventListener surface. See VoiceEvent in types.
   */
  private handleIntentInvoked(event: {
    intentId: string;
    parameters?: Record<string, unknown>;
    data?: unknown;
  }): void {
    const registration = this.registeredIntents.get(event.intentId);
    if (!registration || registration.enabled === false) {
      // Unknown / disabled intent — emission from a stale donation or
      // another session. Silently ignore so the JS layer doesn't crash
      // on surprise events.
      return;
    }

    // Native modules pass invocation args under either `parameters`
    // (new path) or `data` (legacy payload shape). Accept both.
    const params = event.parameters ?? (event.data as Record<string, unknown> | undefined) ?? {};

    // Run the user's registered handler. Errors are surfaced via the
    // handler's own onError if defined, else logged. Note: observers
    // wanting to react to completion / failure subscribe to the
    // onIntentCompleted / onIntentFailed events, not to invocation.
    void this.executeIntent(event.intentId, params).catch((err) => {
      console.error(
        `expo-assistant: handler for ${event.intentId} threw during invocation`,
        err
      );
    });
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
