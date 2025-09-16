import { registerWebModule, NativeModule } from 'expo';

import { ExpoAssistantModuleEvents } from './ExpoAssistant.types';

class ExpoAssistantModule extends NativeModule<ExpoAssistantModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
}

export default registerWebModule(ExpoAssistantModule, 'ExpoAssistantModule');
