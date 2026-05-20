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
  EntityRecord,
  EntityResolver,
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
  private entityResolvers: Map<string, EntityResolver<EntityRecord>> = new Map();
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
    // AppEntity query request/response bridge — pod's EntityResolver
    // fires onEntityQuery; JS resolves matches and calls back via
    // ExpoAssistantModule.respondToEntityQuery. See registerEntityResolver
    // below for the developer-facing API.
    ExpoAssistantModule.addListener(
      "onEntityQuery",
      this.handleEntityQuery.bind(this)
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

  /**
   * Register a JS-side resolver for an AppEntity type declared in
   * `app.json` → `ios.entities[]`. The resolver answers three kinds of
   * query that iOS makes at scan time:
   *
   *   - `matching(search)` — fuzzy lookup against a free-form spoken
   *     phrase. Drives Spotlight autocomplete + Siri voice extraction.
   *   - `resolve(ids)` — given a list of entity ids (which iOS may
   *     have remembered from a prior invocation), return the matching
   *     entity dicts. Drives intent re-runs against previously-bound
   *     values.
   *   - `suggested()` — optional. Returns a list of proactive
   *     suggestions iOS may surface (recent / frequent items, etc.).
   *     If omitted, an empty list is used.
   *
   * The resolver must return entity dicts with at minimum `{ id }` plus
   * every property declared on the entity in `app.json` (the plugin
   * codegen reads those keys to populate the generated Swift
   * `<Name>Entity` struct). Extra keys are ignored.
   *
   * The pod-side `EntityResolver` enforces a 1-second timeout —
   * resolvers that exceed it will see iOS receive an empty result and
   * the user UX degrades (no autocomplete, no voice extraction for
   * that scan). Keep matching logic fast (in-memory filter typical).
   *
   * Approach A — async-with-timeout. When the host app is backgrounded
   * and JS isn't alive, queries time out and return empty. The
   * snapshot-store follow-up (#41) will layer system-process-readable
   * persistence on top so backgrounded scanning works too.
   */
  registerEntityResolver<T extends EntityRecord>(
    typeName: string,
    resolver: EntityResolver<T>
  ): void {
    this.entityResolvers.set(typeName, resolver as EntityResolver<EntityRecord>);
    // Tell iOS to re-query AppShortcuts parameters now that this
    // resolver is live. iOS's linkd ingested the metadata at install
    // time (before any JS ran), so phrase slots for our entity types
    // were rejected on the first scan. After we register, iOS will
    // call back into suggestedEntities and accept the slots.
    void ExpoAssistantModule.updateAppShortcutParameters().catch(() => {});
  }

  unregisterEntityResolver(typeName: string): void {
    this.entityResolvers.delete(typeName);
  }

  /**
   * Force iOS to re-query the AppShortcutsProvider's entity-typed
   * parameter values. Normally you don't need to call this manually —
   * `registerEntityResolver` auto-triggers it. Use this when your
   * resolver's underlying data set has changed in a way that should
   * be reflected in Spotlight / Siri immediately (e.g. user just
   * created a new Project they expect to be voice-targetable).
   */
  async updateAppShortcutParameters(): Promise<void> {
    await ExpoAssistantModule.updateAppShortcutParameters();
  }

  /**
   * Native → JS: pod's EntityResolver has fired an `onEntityQuery`
   * event and is waiting on `respondToEntityQuery` to resolve its
   * continuation. We look up the registered resolver by typeName,
   * dispatch by `kind`, and pass the result back.
   *
   * If no resolver is registered (or it throws / the kind is unknown),
   * we respond with an empty array — same end-state as a timeout, so
   * iOS's scan continues with no entities rather than blocking
   * indefinitely.
   */
  private async handleEntityQuery(event: {
    requestId: string;
    typeName: string;
    kind: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    const resolver = this.entityResolvers.get(event.typeName);
    let entities: EntityRecord[] = [];
    if (resolver) {
      try {
        switch (event.kind) {
          case "matching": {
            const search = (event.payload.search as string) ?? "";
            entities = await resolver.matching(search);
            break;
          }
          case "for": {
            const ids = (event.payload.ids as string[]) ?? [];
            entities = await resolver.resolve(ids);
            break;
          }
          case "suggested": {
            entities = resolver.suggested ? await resolver.suggested() : [];
            break;
          }
        }
      } catch (err) {
        console.error(
          `expo-assistant: entity resolver for "${event.typeName}" (kind=${event.kind}) threw`,
          err
        );
        entities = [];
      }
    }
    try {
      await ExpoAssistantModule.respondToEntityQuery(
        event.requestId,
        entities as Array<Record<string, unknown>>
      );
    } catch {
      // Late response — native side already timed out and dropped the
      // continuation. Silently absorb so a slow resolver doesn't
      // surface as a JS error.
    }
  }
}

export default VoiceAssistant;
