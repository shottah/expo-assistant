import { requireNativeView } from 'expo';
import * as React from 'react';

import { ExpoAssistantViewProps } from './ExpoAssistant.types';

const NativeView: React.ComponentType<ExpoAssistantViewProps> =
  requireNativeView('ExpoAssistant');

export default function ExpoAssistantView(props: ExpoAssistantViewProps) {
  return <NativeView {...props} />;
}
