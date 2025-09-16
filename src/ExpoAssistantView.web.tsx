import * as React from 'react';

import { ExpoAssistantViewProps } from './ExpoAssistant.types';

export default function ExpoAssistantView(props: ExpoAssistantViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
