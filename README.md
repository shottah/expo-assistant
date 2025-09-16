# expo-assistant

Native voice assistant integration for Expo apps with Siri and Google Assistant support.

## Features

- 🎙️ **Siri Integration** - SiriKit and App Intents (iOS 16+) support
- 🤖 **Google Assistant** - App Actions and Built-in Intents
- 🔧 **Config Plugin** - Automated native setup for iOS/Android
- 📱 **Cross-Platform** - Unified API for both platforms
- 🎯 **TypeScript** - Full type safety and IntelliSense
- 🧪 **Well Tested** - 89% test coverage with 72 tests

## Installation

```bash
npx expo install expo-assistant
```

## Configuration

Add the config plugin to your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-assistant",
        {
          "intents": ["search", "media", "productivity"],
          "enableSiriKit": true,
          "enableAppActions": true
        }
      ]
    ]
  }
}
```

## Basic Usage

```typescript
import { VoiceAssistant, VoiceIntentBuilder, IntentCategory } from 'expo-assistant';

// Initialize voice assistant
const assistant = await VoiceAssistant.initialize();

// Create a search intent
const searchIntent = VoiceIntentBuilder
  .create<{ query: string }>()
  .withId('search-products')
  .withCategory(IntentCategory.SEARCH)
  .requiredParameter('query', {
    type: ParameterType.STRING,
    prompt: 'What would you like to search for?'
  })
  .withHandler({
    handle: async (params) => {
      const results = await searchProducts(params.query);
      return { success: true, data: results };
    }
  })
  .build();

// Register the intent
await assistant.registerIntent(searchIntent);

// Request permissions
await assistant.requestMicrophonePermission();
await assistant.requestSpeechRecognitionPermission();
```

## Platform Setup

### iOS
- Requires iOS 13.0+
- SiriKit for iOS 10+ compatibility
- App Intents for iOS 16+ features
- Automatic Info.plist and entitlements configuration via config plugin

### Android
- Requires Android API 23+
- Google Assistant App Actions
- Built-in Intents (BIIs) support
- Automatic AndroidManifest.xml and shortcuts.xml configuration via config plugin

## Intent Categories

- **Search** - Voice-powered search queries
- **Media** - Playback control (play, pause, skip)
- **Productivity** - Tasks, notes, reminders
- **Health** - Workouts and fitness tracking
- **Communication** - Messages and calls
- **Travel** - Reservations and navigation
- **Finance** - Payments and transactions
- **Commerce** - Shopping and orders

## Advanced Configuration

```javascript
{
  "expo": {
    "plugins": [
      [
        "expo-assistant",
        {
          "intents": ["media", "productivity"],
          "enableBackgroundExecution": true,
          "ios": {
            "siriUsageDescription": "Control music with your voice",
            "alternativeAppNames": ["My Music App"],
            "requiresUnlock": false
          },
          "android": {
            "appActionsTestUrl": "https://myapp.com/test-actions",
            "slicesEnabled": true
          }
        }
      ]
    ]
  }
}
```

## API Reference

### VoiceAssistant

- `initialize(config?)` - Initialize the assistant
- `registerIntent(intent)` - Register a voice intent
- `unregisterIntent(intentId)` - Unregister an intent
- `executeIntent(intentId, params)` - Execute an intent programmatically
- `requestMicrophonePermission()` - Request mic access
- `requestSpeechRecognitionPermission()` - Request speech recognition
- `checkCapabilities()` - Check platform capabilities

### VoiceIntentBuilder

Fluent API for building voice intents:

```typescript
const intent = VoiceIntentBuilder
  .create<ParamsType>()
  .withId('unique-id')
  .withCategory(IntentCategory.MEDIA)
  .requiredParameter('title', { type: ParameterType.STRING })
  .optionalParameter('artist', { type: ParameterType.STRING })
  .withHandler({ handle: async (params) => {...} })
  .configureIOS(ios => ios.addSiriPhrase('Play music'))
  .configureAndroid(android => android.withCapability('actions.intent.PLAY_MEDIA'))
  .build();
```

## Examples

### Media Control
```typescript
const playIntent = VoiceIntentBuilder
  .create<{ mediaTitle: string }>()
  .withId('play-media')
  .withCategory(IntentCategory.MEDIA)
  .requiredParameter('mediaTitle', { type: ParameterType.STRING })
  .withHandler({
    handle: async ({ mediaTitle }) => {
      await mediaPlayer.play(mediaTitle);
      return { success: true };
    }
  })
  .withBackgroundExecution()
  .build();
```

### Todo Management
```typescript
const todoIntent = VoiceIntentBuilder
  .create<{ action: 'add' | 'complete'; item: string }>()
  .withId('manage-todo')
  .withCategory(IntentCategory.PRODUCTIVITY)
  .requiredParameter('action', {
    type: ParameterType.ENUM,
    choices: ['add', 'complete']
  })
  .requiredParameter('item', { type: ParameterType.STRING })
  .withHandler({
    handle: async ({ action, item }) => {
      if (action === 'add') {
        return await todoService.add(item);
      }
      return await todoService.complete(item);
    }
  })
  .build();
```

## Requirements

- Expo SDK 53+ (tested with SDK 54)
- React Native 0.74.0+
- TypeScript 4.5+
- Physical device for testing (simulators have limited voice support)

## Documentation

- [Config Plugin Guide](./PLUGIN.md) - Detailed plugin configuration
- [API Documentation](https://github.com/shottah/expo-assistant/wiki) - Full API reference
- [Examples](./example) - Sample implementations

## Contributing

Contributions are welcome! Please read our [contributing guidelines](./CONTRIBUTING.md) first.

## License

MIT © [shottah](https://github.com/shottah)

## Support

- [GitHub Issues](https://github.com/shottah/expo-assistant/issues)
- [Discord Community](https://discord.gg/expo-assistant)

---

Built with ❤️ using Expo Modules API