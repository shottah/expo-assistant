// Reexport the native module. On web, it will be resolved to ExpoAssistantModule.web.ts
// and on native platforms to ExpoAssistantModule.ts
export { default } from './ExpoAssistantModule';
export { default as ExpoAssistantView } from './ExpoAssistantView';
export * from  './ExpoAssistant.types';
