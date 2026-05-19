import ExpoAssistantModule from "../ExpoAssistantModule";
import { VoiceAssistant } from "../VoiceAssistant";
import { VoiceIntentBuilder } from "../builders/VoiceIntentBuilder";
import {
  IntentCategory,
  ParameterType,
  PermissionStatus,
} from "../types/VoiceAssistant.types";

jest.mock("../ExpoAssistantModule");

describe("VoiceAssistant", () => {
  let voiceAssistant: VoiceAssistant;
  const mockModule = ExpoAssistantModule as jest.Mocked<
    typeof ExpoAssistantModule
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    (VoiceAssistant as any).instance = null;

    mockModule.initialize.mockResolvedValue(undefined);
    mockModule.registerIntent.mockResolvedValue(undefined);
    mockModule.getPlatform.mockResolvedValue("ios");
    mockModule.getLocale.mockResolvedValue("en-US");
    mockModule.addListener.mockImplementation(() => ({ remove: () => {} }));
  });

  describe("Initialization", () => {
    it("should initialize singleton instance", async () => {
      const instance1 = await VoiceAssistant.initialize();
      const instance2 = await VoiceAssistant.initialize();

      expect(instance1).toBe(instance2);
      expect(mockModule.initialize).toHaveBeenCalledTimes(1);
    });

    it("should initialize with configuration", async () => {
      const config = {
        enableBackgroundExecution: true,
        debugMode: true,
      };

      await VoiceAssistant.initialize(config);

      expect(mockModule.initialize).toHaveBeenCalledWith(config);
    });

    it("should setup event listeners on initialization", async () => {
      await VoiceAssistant.initialize();

      expect(mockModule.addListener).toHaveBeenCalledWith(
        "onIntentInvoked",
        expect.any(Function)
      );
      expect(mockModule.addListener).toHaveBeenCalledWith(
        "onIntentCompleted",
        expect.any(Function)
      );
      expect(mockModule.addListener).toHaveBeenCalledWith(
        "onIntentFailed",
        expect.any(Function)
      );
    });

    it("should handle initialization failure", async () => {
      mockModule.initialize.mockRejectedValue(new Error("Init failed"));

      await expect(VoiceAssistant.initialize()).rejects.toThrow("Init failed");
    });
  });

  describe("Intent Registration", () => {
    beforeEach(async () => {
      voiceAssistant = await VoiceAssistant.initialize();
    });

    it("should register single intent", async () => {
      const intent = VoiceIntentBuilder.create()
        .withId("test-intent")
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({ handle: async () => ({}) })
        .build();

      mockModule.registerIntent.mockResolvedValue(undefined);

      await voiceAssistant.registerIntent(intent);

      expect(mockModule.registerIntent).toHaveBeenCalledWith({
        id: "test-intent",
        category: IntentCategory.CUSTOM,
        parameters: [],
        platforms: { ios: undefined, android: undefined },
      });

      const registeredIntents = voiceAssistant.getRegisteredIntents();
      expect(registeredIntents).toHaveLength(1);
      expect(registeredIntents[0].intent.id).toBe("test-intent");
    });

    it("should register intent with priority", async () => {
      const intent = VoiceIntentBuilder.create()
        .withId("priority-intent")
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({ handle: async () => ({}) })
        .build();

      await voiceAssistant.registerIntent(intent, { priority: 10 });

      const registeredIntents = voiceAssistant.getRegisteredIntents();
      expect(registeredIntents[0].priority).toBe(10);
    });

    it("should register multiple intents", async () => {
      const intents = [
        VoiceIntentBuilder.create()
          .withId("intent1")
          .withCategory(IntentCategory.SEARCH)
          .withHandler({ handle: async () => ({}) })
          .build(),
        VoiceIntentBuilder.create()
          .withId("intent2")
          .withCategory(IntentCategory.MEDIA)
          .withHandler({ handle: async () => ({}) })
          .build(),
      ];

      await voiceAssistant.registerIntents(intents);

      expect(mockModule.registerIntent).toHaveBeenCalledTimes(2);
      expect(voiceAssistant.getRegisteredIntents()).toHaveLength(2);
    });

    it("should handle registration failure", async () => {
      const intent = VoiceIntentBuilder.create()
        .withId("fail-intent")
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({ handle: async () => ({}) })
        .build();

      mockModule.registerIntent.mockRejectedValue(
        new Error("Registration failed")
      );

      await expect(voiceAssistant.registerIntent(intent)).rejects.toThrow(
        "Registration failed"
      );
      expect(voiceAssistant.getRegisteredIntents()).toHaveLength(0);
    });

    it("should unregister intent", async () => {
      const intent = VoiceIntentBuilder.create()
        .withId("temp-intent")
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({ handle: async () => ({}) })
        .build();

      await voiceAssistant.registerIntent(intent);
      expect(voiceAssistant.getRegisteredIntents()).toHaveLength(1);

      mockModule.unregisterIntent.mockResolvedValue(undefined);
      await voiceAssistant.unregisterIntent("temp-intent");

      expect(mockModule.unregisterIntent).toHaveBeenCalledWith("temp-intent");
      expect(voiceAssistant.getRegisteredIntents()).toHaveLength(0);
    });

    it("should throw when unregistering non-existent intent", async () => {
      await expect(
        voiceAssistant.unregisterIntent("non-existent")
      ).rejects.toThrow("Intent non-existent not registered");
    });
  });

  describe("Intent Execution", () => {
    beforeEach(async () => {
      voiceAssistant = await VoiceAssistant.initialize();
    });

    it("should execute intent with parameters", async () => {
      const handler = jest.fn().mockResolvedValue({ result: "success" });

      const intent = VoiceIntentBuilder.create<{ query: string }>()
        .withId("search-intent")
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter("query", { type: ParameterType.STRING })
        .withHandler({ handle: handler })
        .build();

      await voiceAssistant.registerIntent(intent);

      const result = await voiceAssistant.executeIntent("search-intent", {
        query: "test",
      });

      expect(handler).toHaveBeenCalledWith(
        { query: "test" },
        expect.objectContaining({
          platform: "ios",
          locale: "en-US",
          sessionId: expect.any(String),
          timestamp: expect.any(Date),
        })
      );

      expect(result).toEqual({
        success: true,
        data: { result: "success" },
      });
    });

    it("should handle parameter resolution", async () => {
      const intent = VoiceIntentBuilder.create<{ query: string }>()
        .withId("resolve-intent")
        .withCategory(IntentCategory.SEARCH)
        .withHandler({
          resolve: async (params) => {
            if (!params.query) {
              return { needsValue: "query" };
            }
            return params as { query: string };
          },
          handle: async (params) => ({ results: [params.query] }),
        })
        .build();

      await voiceAssistant.registerIntent(intent);

      const result = await voiceAssistant.executeIntent("resolve-intent", {});

      expect(result).toEqual({
        success: false,
        needsDisambiguation: true,
        message: "Need value for: query",
      });
    });

    it("should handle execution errors", async () => {
      const intent = VoiceIntentBuilder.create()
        .withId("error-intent")
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({
          handle: async () => {
            throw new Error("Execution failed");
          },
        })
        .build();

      await voiceAssistant.registerIntent(intent);

      const result = await voiceAssistant.executeIntent("error-intent", {});

      expect(result).toEqual({
        success: false,
        error: "Execution failed",
      });
    });

    it("should use error handler when provided", async () => {
      const intent = VoiceIntentBuilder.create()
        .withId("handled-error-intent")
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({
          handle: async () => {
            throw new Error("Expected error");
          },
          onError: async (error) => ({ fallback: "Error handled gracefully" }),
        })
        .build();

      await voiceAssistant.registerIntent(intent);

      const result = await voiceAssistant.executeIntent(
        "handled-error-intent",
        {}
      );

      expect(result).toEqual({
        success: false,
        data: { fallback: "Error handled gracefully" },
        error: "Expected error",
      });
    });

    it("should throw when executing non-registered intent", async () => {
      await expect(voiceAssistant.executeIntent("unknown", {})).rejects.toThrow(
        "Intent unknown not registered"
      );
    });
  });

  describe("Intent Donation", () => {
    beforeEach(async () => {
      voiceAssistant = await VoiceAssistant.initialize();
    });

    it("should donate intent for Siri suggestions", async () => {
      const intent = VoiceIntentBuilder.create()
        .withId("donate-intent")
        .withCategory(IntentCategory.PRODUCTIVITY)
        .withHandler({ handle: async () => ({}) })
        .build();

      await voiceAssistant.registerIntent(intent);

      mockModule.donateIntent.mockResolvedValue(undefined);

      await voiceAssistant.donateIntent("donate-intent", {
        task: "Complete report",
      });

      expect(mockModule.donateIntent).toHaveBeenCalledWith("donate-intent", {
        task: "Complete report",
      });
    });

    it("should throw when donating non-registered intent", async () => {
      await expect(voiceAssistant.donateIntent("unknown", {})).rejects.toThrow(
        "Intent unknown not registered"
      );
    });
  });

  describe("Permissions", () => {
    beforeEach(async () => {
      voiceAssistant = await VoiceAssistant.initialize();
    });

    it("should request microphone permission", async () => {
      mockModule.requestMicrophonePermission.mockResolvedValue(
        PermissionStatus.GRANTED
      );

      const status = await voiceAssistant.requestMicrophonePermission();

      expect(status).toBe(PermissionStatus.GRANTED);
      expect(mockModule.requestMicrophonePermission).toHaveBeenCalled();
    });

    it("should request speech recognition permission", async () => {
      mockModule.requestSpeechRecognitionPermission.mockResolvedValue(
        PermissionStatus.GRANTED
      );

      const status = await voiceAssistant.requestSpeechRecognitionPermission();

      expect(status).toBe(PermissionStatus.GRANTED);
      expect(mockModule.requestSpeechRecognitionPermission).toHaveBeenCalled();
    });

    it("should check platform capabilities", async () => {
      const capabilities = {
        ios: {
          siriKitSupported: true,
          appIntentsSupported: true,
          availableDomains: ["INSearchForMessagesIntent"],
          speechRecognitionAvailable: true,
        },
      };

      mockModule.checkCapabilities.mockResolvedValue(capabilities);

      const result = await voiceAssistant.checkCapabilities();

      expect(result).toEqual(capabilities);
    });
  });

  describe("Event Handling", () => {
    let eventHandler: jest.Mock;

    beforeEach(async () => {
      voiceAssistant = await VoiceAssistant.initialize();
      eventHandler = jest.fn();
    });

    it("should add and trigger event listeners for lifecycle events", async () => {
      // Observer bus is for completion/failure lifecycle events, not
      // invocation (invocation is push-only — see VoiceAssistant docstring).
      voiceAssistant.addEventListener("onIntentCompleted", eventHandler);

      const completedHandler = mockModule.addListener.mock.calls.find(
        (call) => call[0] === "onIntentCompleted"
      )?.[1];

      completedHandler?.({
        intentId: "event-intent",
        data: { result: "ok" },
      });

      expect(eventHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "onIntentCompleted",
          intentId: "event-intent",
          data: { result: "ok" },
          timestamp: expect.any(Date),
        })
      );
    });

    it("should remove event listeners", () => {
      const unsubscribe = voiceAssistant.addEventListener(
        "onIntentCompleted",
        eventHandler
      );

      unsubscribe();

      const completedHandler = mockModule.addListener.mock.calls.find(
        (call) => call[0] === "onIntentCompleted"
      )?.[1];

      completedHandler?.({ intentId: "test", data: {} });

      expect(eventHandler).not.toHaveBeenCalled();
    });

    it("should handle multiple listeners for same event", async () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const intent = VoiceIntentBuilder.create()
        .withId("multi-listener")
        .withCategory(IntentCategory.CUSTOM)
        .withHandler({ handle: async () => ({}) })
        .build();

      await voiceAssistant.registerIntent(intent);

      voiceAssistant.addEventListener("onIntentFailed", handler1);
      voiceAssistant.addEventListener("onIntentFailed", handler2);

      const failedHandler = mockModule.addListener.mock.calls.find(
        (call) => call[0] === "onIntentFailed"
      )?.[1];

      failedHandler?.({ intentId: "multi-listener", error: new Error("Test") });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });
  });

  describe("Intent Invocation (voice → JS handler)", () => {
    beforeEach(async () => {
      voiceAssistant = await VoiceAssistant.initialize();
    });

    it("routes onIntentInvoked events to the registered handler — push model, no observer fan-out", async () => {
      const handlerMock = jest.fn().mockResolvedValue({ ok: true });
      const intent = VoiceIntentBuilder.create<{ query: string }>()
        .withId("search")
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter("query", { type: ParameterType.STRING })
        .withHandler({ handle: handlerMock })
        .build();

      await voiceAssistant.registerIntent(intent);

      const invokedListener = mockModule.addListener.mock.calls.find(
        (call) => call[0] === "onIntentInvoked"
      )?.[1];
      expect(invokedListener).toBeDefined();

      invokedListener!({ intentId: "search", parameters: { query: "tacos" } });

      // Flush microtasks so the async dispatch completes.
      await new Promise((resolve) => setImmediate(resolve));

      // Handler ran with the invocation parameters.
      expect(handlerMock).toHaveBeenCalledWith(
        { query: "tacos" },
        expect.objectContaining({
          platform: "ios",
          locale: "en-US",
          sessionId: expect.any(String),
          timestamp: expect.any(Date),
        })
      );
    });

    it("does not fan out invocation events to observers — push-only design", async () => {
      const handlerMock = jest.fn().mockResolvedValue({ ok: true });
      const observer = jest.fn();
      const intent = VoiceIntentBuilder.create<{ query: string }>()
        .withId("search-noobs")
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter("query", { type: ParameterType.STRING })
        .withHandler({ handle: handlerMock })
        .build();

      await voiceAssistant.registerIntent(intent);
      // Subscribing with the legacy event name is intentionally a no-op —
      // invocation is push-only. VoiceEvent.type doesn't include
      // "onIntentInvoked"; the cast here mimics a stale call site.
      voiceAssistant.addEventListener(
        "onIntentInvoked" as any,
        observer
      );

      const invokedListener = mockModule.addListener.mock.calls.find(
        (call) => call[0] === "onIntentInvoked"
      )?.[1];
      invokedListener!({
        intentId: "search-noobs",
        parameters: { query: "tacos" },
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(handlerMock).toHaveBeenCalled();
      expect(observer).not.toHaveBeenCalled();
    });

    it("silently drops onIntentInvoked for unknown intentId", async () => {
      const invokedListener = mockModule.addListener.mock.calls.find(
        (call) => call[0] === "onIntentInvoked"
      )?.[1];
      expect(invokedListener).toBeDefined();

      // Should not throw, should not warn loudly.
      expect(() =>
        invokedListener!({ intentId: "never-registered", parameters: {} })
      ).not.toThrow();
      await new Promise((resolve) => setImmediate(resolve));
    });

    it("runs the handler's resolver and routes through executeIntent", async () => {
      const handlerMock = jest.fn().mockResolvedValue({ ok: true });
      const resolveMock = jest.fn().mockImplementation(async (params: any) => {
        if (!params.query) return { needsValue: "query" };
        return params;
      });

      const intent = VoiceIntentBuilder.create<{ query: string }>()
        .withId("search-resolve")
        .withCategory(IntentCategory.SEARCH)
        .requiredParameter("query", { type: ParameterType.STRING })
        .withHandler({ resolve: resolveMock, handle: handlerMock })
        .build();

      await voiceAssistant.registerIntent(intent);

      const invokedListener = mockModule.addListener.mock.calls.find(
        (call) => call[0] === "onIntentInvoked"
      )?.[1];

      // Missing query → resolver returns needsValue → handler not called.
      invokedListener!({ intentId: "search-resolve", parameters: {} });
      await new Promise((resolve) => setImmediate(resolve));
      expect(resolveMock).toHaveBeenCalled();
      expect(handlerMock).not.toHaveBeenCalled();

      // With query → handler is called.
      invokedListener!({
        intentId: "search-resolve",
        parameters: { query: "tacos" },
      });
      await new Promise((resolve) => setImmediate(resolve));
      expect(handlerMock).toHaveBeenCalledWith(
        { query: "tacos" },
        expect.any(Object)
      );
    });
  });

  describe("Platform Features", () => {
    beforeEach(async () => {
      voiceAssistant = await VoiceAssistant.initialize();
    });

    it("should enable SiriKit", async () => {
      mockModule.enableSiriKit.mockResolvedValue(undefined);

      await voiceAssistant.enableSiriKit();

      expect(mockModule.enableSiriKit).toHaveBeenCalled();
    });

    it("should enable App Actions", async () => {
      mockModule.enableAppActions.mockResolvedValue(undefined);

      await voiceAssistant.enableAppActions();

      expect(mockModule.enableAppActions).toHaveBeenCalled();
    });

    it("should enable background processing", async () => {
      mockModule.enableBackgroundProcessing.mockResolvedValue(undefined);

      await voiceAssistant.enableBackgroundProcessing();

      expect(mockModule.enableBackgroundProcessing).toHaveBeenCalled();
    });

    it("should enable custom UI", async () => {
      mockModule.enableCustomUI.mockResolvedValue(undefined);

      await voiceAssistant.enableCustomUI();

      expect(mockModule.enableCustomUI).toHaveBeenCalled();
    });

    it("should set debug mode", async () => {
      mockModule.setDebugMode.mockResolvedValue(undefined);

      await voiceAssistant.setDebugMode(true);

      expect(mockModule.setDebugMode).toHaveBeenCalledWith(true);
    });
  });
});
