# Building an expo-modules voice assistant package

This comprehensive technical guide provides everything needed to create an expo-modules package that wraps SiriKit (iOS) and Android voice assistant functionality, supporting both Expo managed and bare workflows for SDK 53/54.

## Complete API contracts for voice assistant integration

The research reveals fundamental differences between iOS and Android voice assistant architectures that must be carefully abstracted. iOS offers **two distinct approaches**: the traditional SiriKit framework (iOS 10+) and the modern App Intents framework (iOS 16+). Most SiriKit domains were deprecated in iOS 15, with only **Messaging, VoIP Calling, Media, Workouts, and Restaurant Reservations** remaining fully supported. The newer App Intents framework provides more flexibility through the `AppIntent` protocol with async/await support and the `AppShortcutsProvider` for defining voice phrases.

Android's ecosystem centers around **Google Assistant App Actions** using Built-in Intents (BIIs) across categories including Health & Fitness, Communication, Travel, Finance, and Commerce. The implementation leverages `shortcuts.xml` for capability declarations and the `ShortcutManager` API for dynamic shortcuts. Android also provides supplementary APIs like Voice Access for system-level control and Slices for interactive Assistant UI components.

## Expo module architecture for SDK 53/54

The module structure requires careful organization to support both platforms while maintaining Expo's autolinking capabilities:

```typescript
// expo-module.config.json
{
  "platforms": ["ios", "android"],
  "ios": {
    "modules": ["VoiceAssistantModule"],
    "appDelegateSubscribers": ["VoiceAssistantAppDelegate"]
  },
  "android": {
    "modules": ["expo.modules.voiceassistant.VoiceAssistantModule"]
  }
}
```

### Native module implementation with Swift

```swift
import ExpoModulesCore
import Intents

public class VoiceAssistantModule: Module {
    public func definition() -> ModuleDefinition {
        Name("VoiceAssistant")
        
        Events("onIntentReceived", "onIntentCompleted", "onIntentFailed")
        
        AsyncFunction("registerIntent") { (intentConfig: IntentConfig) -> Promise<Void> in
            // Register custom intent or App Intent
            if #available(iOS 16.0, *) {
                // Use App Intents framework
                return registerAppIntent(intentConfig)
            } else {
                // Fallback to SiriKit custom intents
                return registerSiriKitIntent(intentConfig)
            }
        }
        
        AsyncFunction("donateIntent") { (intentId: String, parameters: [String: Any]) -> Promise<Void> in
            // Donate interaction for Siri suggestions
            let interaction = createInteraction(intentId, parameters)
            return donateInteraction(interaction)
        }
    }
}
```

### Native module implementation with Kotlin

```kotlin
package expo.modules.voiceassistant

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import android.content.Intent
import com.google.android.gms.actions.NoteIntents

class VoiceAssistantModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("VoiceAssistant")
        
        Events("onIntentReceived", "onIntentCompleted", "onIntentFailed")
        
        AsyncFunction("registerIntent") { intentConfig: IntentConfig ->
            // Generate shortcuts.xml entry dynamically
            val shortcut = createDynamicShortcut(intentConfig)
            shortcutManager.addDynamicShortcuts(listOf(shortcut))
        }
        
        Function("handleAppAction") { intent: Intent ->
            when (intent.action) {
                "actions.intent.START_EXERCISE" -> handleExerciseIntent(intent)
                "actions.intent.GET_THING" -> handleSearchIntent(intent)
                else -> handleCustomIntent(intent)
            }
        }
    }
}
```

## TypeScript API design for unified abstraction

The TypeScript API provides a fluent interface that abstracts platform differences while preserving platform-specific capabilities:

```typescript
interface VoiceIntent<TParams = Record<string, unknown>, TResponse = unknown> {
  readonly id: string;
  readonly category: IntentCategory;
  readonly parameters: VoiceParameter[];
  readonly handler: IntentHandler<TParams, TResponse>;
  readonly platforms: {
    ios?: {
      siriKitDomain?: string;
      appIntentSchema?: string;
      phrases: string[];
    };
    android?: {
      biiCategory?: string;
      capability: string;
      parameters: AndroidParameter[];
    };
  };
}

// Fluent builder pattern for intent creation
class VoiceIntentBuilder<TParams = {}, TBuilt extends keyof TParams = never> {
  category<C extends IntentCategory>(category: C): VoiceIntentBuilder<TParams, TBuilt>;
  
  parameter<K extends string, V>(
    name: K,
    config: ParameterConfig<V>
  ): VoiceIntentBuilder<TParams & Record<K, V>, TBuilt | K>;
  
  handler<R>(
    handler: IntentHandler<TParams, R>
  ): VoiceIntentFinal<TParams, R>;
}
```

## Implementation patterns for key functionality

### Query handling through voice commands

The module prioritizes data querying as the primary use case. Voice queries are processed through a multi-stage pipeline: **speech recognition → natural language parsing → parameter extraction → query execution**. The implementation uses platform-specific recognizers (SiriKit/Speech framework on iOS, SpeechRecognizer on Android) but exposes a unified JavaScript API:

```typescript
const searchIntent = VoiceIntentBuilder
  .create<{ query: string; filters?: SearchFilters }>()
  .category(IntentCategory.SEARCH)
  .requiredParameter('query', {
    type: ParameterType.STRING,
    prompt: 'What would you like to search for?'
  })
  .parameter('filters', {
    type: ParameterType.OBJECT,
    parser: parseNaturalLanguageFilters
  })
  .handler({
    resolve: async (params) => {
      // Resolve ambiguous parameters
      if (!params.query) {
        return { needsValue: 'query' };
      }
      return params;
    },
    handle: async (params, context) => {
      const results = await searchService.execute(params);
      return {
        success: true,
        data: results,
        message: `Found ${results.length} results`
      };
    }
  })
  .build();
```

### Voice intent registration and handling

Intent registration differs significantly between platforms. iOS requires **Info.plist modifications** and Intent Extension setup, while Android uses **shortcuts.xml** and manifest declarations. The expo-modules config plugin automates these platform-specific configurations:

```typescript
// Config plugin for automated setup
const withVoiceAssistant: ConfigPlugin<VoicePluginOptions> = (config, options) => {
  return withPlugins(config, [
    // iOS: Add SiriKit entitlements, Info.plist entries, Intent Extensions
    [withIOSVoiceIntents, options],
    // Android: Generate shortcuts.xml, modify AndroidManifest
    [withAndroidVoiceIntents, options]
  ]);
};
```

### Permission and capability management

Both platforms require explicit permissions for voice features. The module provides a unified permission API that handles platform-specific requirements:

```typescript
interface PermissionManager {
  requestMicrophonePermission(): Promise<PermissionStatus>;
  requestSpeechRecognitionPermission(): Promise<PermissionStatus>;
  checkCapabilities(): Promise<PlatformCapabilities>;
}

// Platform capabilities detection
const capabilities = await VoiceAssistant.checkCapabilities();
if (capabilities.ios?.appIntentsSupported) {
  // Use modern App Intents
} else if (capabilities.android?.appActionsSupported) {
  // Use Android App Actions
}
```

## Platform-specific technical requirements

### iOS configuration requirements

iOS integration requires extensive configuration across multiple files. The **Info.plist** must declare usage descriptions for microphone and speech recognition, supported intent types via `NSUserActivityTypes`, and alternative app names for better Siri recognition. **Entitlements** include `com.apple.developer.siri` for SiriKit access and `com.apple.security.application-groups` for data sharing between the main app and extensions.

Intent Extensions require a separate target with its own Info.plist specifying `IntentsSupported` and `IntentsRestrictedWhileLocked`. For iOS 16+, App Intents are defined directly in Swift using the `AppIntent` protocol and registered via `AppShortcutsProvider`, eliminating the need for separate extensions in many cases.

### Android configuration requirements

Android requires **AndroidManifest.xml** modifications for permissions (`RECORD_AUDIO`, `INTERNET`) and the `android.app.shortcuts` metadata pointing to the shortcuts.xml resource. The **shortcuts.xml** file defines capabilities mapping to Built-in Intents or custom actions:

```xml
<capability android:name="actions.intent.START_EXERCISE">
    <intent android:targetClass="com.app.ExerciseActivity">
        <parameter android:name="exercise.name" android:key="exerciseType" />
    </intent>
    <slice android:targetClass="com.app.ExerciseSliceProvider" />
</capability>
```

Deep link verification requires `android:autoVerify="true"` on intent filters and corresponding web asset links. Google Play Console configuration is necessary for App Actions review and deployment.

## Creating a unified API with platform flexibility

The module design follows a **three-layer architecture** to balance abstraction with platform access. The **presentation layer** provides a fluent TypeScript API for developers, the **abstraction layer** normalizes intents across platforms, and the **adapter layer** handles platform-specific implementation details.

Platform differences are exposed through optional enhancement APIs:

```typescript
const intent = baseIntent
  .configureIOS(ios => ios
    .withHealthKitIntegration()
    .withCallKitSupport()
    .addSiriPhrase("Start my workout in $(appName)")
  )
  .configureAndroid(android => android
    .withGoogleFitIntegration()
    .withMediaSessionSupport()
    .addAppActionPhrase("begin exercise with $(appName)")
  );
```

This approach enables **progressive enhancement** - developers can start with basic voice commands and gradually add platform-specific features as needed.

## Practical code patterns for common scenarios

### Media control implementation

```typescript
const mediaControlIntents = [
  createPlayIntent(),
  createPauseIntent(),
  createSkipIntent()
].map(intent => intent
  .withBackgroundExecution()
  .withMediaSessionIntegration()
);

// Register all media intents
await VoiceAssistant.registerIntents(mediaControlIntents);
```

### Todo list voice commands

```typescript
const todoIntents = VoiceIntentBuilder
  .create<{ action: 'add' | 'complete' | 'delete'; item: string }>()
  .category(IntentCategory.PRODUCTIVITY)
  .requiredParameter('action', {
    type: ParameterType.ENUM,
    choices: ['add', 'complete', 'delete']
  })
  .requiredParameter('item', {
    type: ParameterType.STRING
  })
  .handler({
    handle: async ({ action, item }) => {
      switch(action) {
        case 'add': return todoService.add(item);
        case 'complete': return todoService.complete(item);
        case 'delete': return todoService.delete(item);
      }
    }
  })
  .build();
```

## Making features incrementally adoptable

The module design prioritizes incremental adoption through several mechanisms. **Feature detection** allows apps to check available capabilities before attempting to use them. **Graceful degradation** provides fallback implementations when platform features are unavailable. **Optional dependencies** ensure the module works without requiring all platform-specific libraries.

The initialization process follows a progressive pattern:

```typescript
// Level 1: Basic speech recognition
const voice = await VoiceAssistant.initialize();

// Level 2: Add intent handling
await voice.registerIntent(searchIntent);

// Level 3: Platform integration
await voice.enableSiriKit();
await voice.enableAppActions();

// Level 4: Advanced features
await voice.enableBackgroundProcessing();
await voice.enableCustomUI();
```

## Key implementation recommendations

**Development workflow considerations**: Voice features require physical devices for testing - iOS Simulator supports limited Siri testing via "Siri Intent Query" in the scheme editor, while Android emulators may not reliably support speech recognition. Use EAS development builds for testing custom native modules in the managed workflow.

**Performance optimization**: Implement voice command queueing to handle rapid consecutive commands, use background queues for intent processing to avoid blocking the UI thread, and cache frequently used intents and parameters locally. Consider implementing a hybrid approach where simple commands are processed locally while complex queries are sent to backend services.

**Error handling and recovery**: Implement comprehensive error states for network failures, permission denials, and recognition errors. Provide clear user feedback through both visual and audio cues. Include retry mechanisms with exponential backoff for transient failures.

**Security considerations**: Validate all voice input parameters before processing, implement rate limiting to prevent abuse, and ensure sensitive operations require additional authentication. Store voice-related data securely using platform keychains.

This architecture provides a robust foundation for building a production-ready expo-modules package that brings native voice assistant capabilities to React Native applications while maintaining the flexibility and developer experience that Expo provides.