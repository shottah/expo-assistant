import { NativeModule, requireNativeModule } from 'expo';
import {
  VoiceAssistantConfig,
  PlatformCapabilities,
  PermissionStatus,
  VoiceParameter
} from './types/VoiceAssistant.types';

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
  donateIntent(intentId: string, parameters: Record<string, any>): Promise<void>;
  requestMicrophonePermission(): Promise<PermissionStatus>;
  requestSpeechRecognitionPermission(): Promise<PermissionStatus>;
  checkCapabilities(): Promise<PlatformCapabilities>;
  enableSiriKit(): Promise<void>;
  enableAppActions(): Promise<void>;
  enableBackgroundProcessing(): Promise<void>;
  enableCustomUI(): Promise<void>;
  getPlatform(): Promise<'ios' | 'android' | 'web'>;
  getLocale(): Promise<string>;
  setDebugMode(enabled: boolean): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<ExpoAssistantModule>('ExpoAssistant');
