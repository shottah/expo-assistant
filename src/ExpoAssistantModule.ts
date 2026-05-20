import { NativeModule, requireNativeModule } from "expo";

import {
  VoiceAssistantConfig,
  PlatformCapabilities,
  PermissionStatus,
  VoiceParameter,
} from "./types/VoiceAssistant.types";

export interface ExpoAssistantModuleEvents {
  onIntentReceived: (event: { intentId: string; data: any }) => void;
  onIntentCompleted: (event: { intentId: string; data: any }) => void;
  onIntentFailed: (event: { intentId: string; error: Error }) => void;
  [eventName: string]: (event: any) => void;
}

interface IntentConfig {
  id: string;
  category: string;
  parameters: VoiceParameter[];
  platforms: any;
}

declare class ExpoAssistantModule extends NativeModule<ExpoAssistantModuleEvents> {
  initialize(config: VoiceAssistantConfig): Promise<void>;
  registerIntent(config: IntentConfig): Promise<void>;
  unregisterIntent(intentId: string): Promise<void>;
  donateIntent(
    intentId: string,
    parameters: Record<string, any>
  ): Promise<void>;
  requestMicrophonePermission(): Promise<PermissionStatus>;
  requestSpeechRecognitionPermission(): Promise<PermissionStatus>;
  checkCapabilities(): Promise<PlatformCapabilities>;
  enableSiriKit(): Promise<void>;
  enableAppActions(): Promise<void>;
  enableBackgroundProcessing(): Promise<void>;
  enableCustomUI(): Promise<void>;
  getPlatform(): Promise<"ios" | "android" | "web">;
  getLocale(): Promise<string>;
  setDebugMode(enabled: boolean): Promise<void>;
  /**
   * JS-side callback for AppEntity queries (iOS #28). The pod-side
   * EntityResolver fires the `onEntityQuery` event with a unique
   * requestId; the JS layer computes matches via the registered
   * resolver and calls this to pass the results back. Late responses
   * (after the native-side timeout already resolved the continuation
   * with []) are silently no-op'd.
   */
  respondToEntityQuery(
    requestId: string,
    entities: Array<Record<string, any>>
  ): Promise<void>;
  /**
   * Signals iOS to re-query the generated AppShortcutsProvider's
   * entity-typed parameters. iOS responds by calling
   * `suggestedEntities()` on each EntityStringQuery, which round-trips
   * through `respondToEntityQuery`. The package auto-calls this from
   * `VoiceAssistant.registerEntityResolver` so developers normally
   * don't need to invoke it directly; expose it manually only if your
   * resolver's data set has changed materially and you want iOS to
   * re-index immediately.
   */
  updateAppShortcutParameters(): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<ExpoAssistantModule>("ExpoAssistant");
