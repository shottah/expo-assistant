import { NativeModule, requireNativeModule } from 'expo';

import { ExpoAssistantModuleEvents } from './ExpoAssistant.types';

declare class ExpoAssistantModule extends NativeModule<ExpoAssistantModuleEvents> {
  PI: number;
  hello(): string;
  setValueAsync(value: string): Promise<void>;
}

// This call loads the native module object from the JSI.
export default requireNativeModule<ExpoAssistantModule>('ExpoAssistant');
