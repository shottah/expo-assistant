# Expo Assistant Config Plugin Documentation

## Overview

The expo-assistant config plugin automates the complex native configuration required for voice assistant integration on iOS and Android platforms. This plugin handles platform-specific setup including permissions, entitlements, manifest modifications, and resource generation that would otherwise require manual native code changes.

## Installation

```bash
npx expo install expo-assistant
```

## Basic Configuration

Add the plugin to your `app.json` or `app.config.js`:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-assistant",
        {
          "enableSiriKit": true,
          "enableAppActions": true,
          "intents": ["search", "media", "productivity"]
        }
      ]
    ]
  }
}
```

## Configuration Options

### Plugin Configuration Interface

```typescript
interface ExpoAssistantPluginConfig {
  // Core Features
  enableSiriKit?: boolean;           // Enable iOS SiriKit (default: true)
  enableAppIntents?: boolean;        // Enable iOS 16+ App Intents (default: true)
  enableAppActions?: boolean;        // Enable Android App Actions (default: true)
  enableBackgroundExecution?: boolean; // Enable background processing (default: false)

  // Intent Categories to Enable
  intents?: IntentCategory[];        // Array of intent categories to configure

  // iOS Specific
  ios?: {
    siriUsageDescription?: string;   // Custom Siri usage description
    alternativeAppNames?: string[];  // Alternative names for Siri recognition
    intentExtensionBundleId?: string; // Custom Intent Extension bundle ID
    appGroups?: string[];            // App Groups for data sharing
    supportedIntentTypes?: string[];  // NSUserActivityTypes
    requiresUnlock?: boolean;        // Require device unlock (default: true)
  };

  // Android Specific
  android?: {
    appActionsTestUrl?: string;      // Test URL for App Actions testing
    deepLinkVerification?: boolean;  // Enable auto-verify (default: true)
    voiceInteractionService?: boolean; // Custom voice interaction UI (default: false)
    slicesEnabled?: boolean;         // Enable Slices for Assistant UI (default: false)
    customVocabulary?: {             // User-specific terms
      terms: Array<{
        value: string;
        synonyms: string[];
      }>;
    };
  };

  // Development
  debugMode?: boolean;               // Enable debug logging (default: false)
}
```

### Intent Categories

```typescript
enum IntentCategory {
  SEARCH = "search",           // Search and query intents
  MEDIA = "media",            // Media playback control
  PRODUCTIVITY = "productivity", // Tasks, notes, reminders
  HEALTH = "health",          // Workouts and health tracking
  COMMUNICATION = "communication", // Messages and calls
  CUSTOM = "custom"           // Custom app-specific intents
}
```

## Platform-Specific Configurations

### iOS Configuration (What the Plugin Does)

#### 1. Info.plist Modifications

The plugin automatically adds the following entries to your Info.plist:

```xml
<!-- Microphone Usage Description -->
<key>NSMicrophoneUsageDescription</key>
<string>This app needs microphone access for voice commands</string>

<!-- Speech Recognition Usage Description -->
<key>NSSpeechRecognitionUsageDescription</key>
<string>This app uses speech recognition for voice commands</string>

<!-- Siri Usage Description -->
<key>NSSiriUsageDescription</key>
<string>This app uses Siri for voice assistant features</string>

<!-- Alternative App Names for Better Recognition -->
<key>CFBundleSpokenName</key>
<string>Your App Name</string>

<key>INAlternativeAppNames</key>
<array>
  <dict>
    <key>INAlternativeAppName</key>
    <string>Alternative Name 1</string>
  </dict>
</array>

<!-- Supported User Activity Types -->
<key>NSUserActivityTypes</key>
<array>
  <string>com.yourapp.search</string>
  <string>com.yourapp.playMedia</string>
  <string>INSearchIntent</string>
  <string>INPlayMediaIntent</string>
</array>
```

**Documentation**: [Apple Info.plist Keys](https://developer.apple.com/documentation/bundleresources/information_property_list)

#### 2. Entitlements

The plugin adds necessary entitlements to your `.entitlements` file:

```xml
<!-- SiriKit Entitlement -->
<key>com.apple.developer.siri</key>
<true/>

<!-- App Groups (for data sharing with extensions) -->
<key>com.apple.security.application-groups</key>
<array>
  <string>group.com.yourapp.voiceassistant</string>
</array>

<!-- Background Modes (if enabled) -->
<key>UIBackgroundModes</key>
<array>
  <string>audio</string>
  <string>processing</string>
</array>
```

**Documentation**:
- [SiriKit Entitlements](https://developer.apple.com/documentation/sirikit/requesting_authorization_to_use_sirikit)
- [App Groups](https://developer.apple.com/documentation/security/keychain_services/keychain_items/sharing_access_to_keychain_items_among_a_collection_of_apps)

#### 3. Intent Extension (if custom intents are used)

For custom intents, the plugin generates an Intent Extension target with:

- Separate `Info.plist` with supported intents
- Intent definition files (`.intentdefinition`)
- Extension source files
- Proper provisioning profiles

```xml
<!-- Intent Extension Info.plist -->
<key>NSExtension</key>
<dict>
  <key>NSExtensionPointIdentifier</key>
  <string>com.apple.intents-service</string>
  <key>NSExtensionPrincipalClass</key>
  <string>$(PRODUCT_MODULE_NAME).IntentHandler</string>
  <key>IntentsSupported</key>
  <array>
    <string>SearchIntent</string>
    <string>PlayMediaIntent</string>
  </array>
  <key>IntentsRestrictedWhileLocked</key>
  <array>
    <string>PaymentIntent</string>
  </array>
</dict>
```

**Documentation**: [Creating an Intents Extension](https://developer.apple.com/documentation/SiriKit/creating-an-intents-app-extension)

#### 4. App Intents (iOS 16+)

For iOS 16+, the plugin configures App Intents framework support:

- Generates `AppShortcuts.swift` with voice phrases
- Creates `AppIntent` protocol implementations
- Configures Focus filters and widgets

**Documentation**: [App Intents Framework](https://developer.apple.com/documentation/appintents)

### Android Configuration (What the Plugin Does)

#### 1. AndroidManifest.xml Modifications

The plugin adds permissions and metadata to your AndroidManifest.xml:

```xml
<!-- Permissions -->
<uses-permission android:name="android.permission.RECORD_AUDIO" />
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.INSTALL_SHORTCUT" />

<!-- App Actions Metadata -->
<meta-data
  android:name="android.app.shortcuts"
  android:resource="@xml/shortcuts" />

<!-- Deep Link Intent Filters -->
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https"
        android:host="yourapp.com"
        android:pathPrefix="/action" />
</intent-filter>

<!-- Voice Interaction Service (if enabled) -->
<service
  android:name=".VoiceInteractionService"
  android:permission="android.permission.BIND_VOICE_INTERACTION">
  <intent-filter>
    <action android:name="android.service.voice.VoiceInteractionService" />
  </intent-filter>
</service>
```

**Documentation**:
- [Android Manifest Permissions](https://developer.android.com/guide/topics/permissions/overview)
- [App Actions Overview](https://developers.google.com/assistant/app/overview)

#### 2. shortcuts.xml Generation

The plugin generates `res/xml/shortcuts.xml` with capability declarations:

```xml
<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <!-- Search Capability -->
  <capability android:name="actions.intent.GET_THING">
    <intent
      android:action="com.yourapp.SEARCH"
      android:targetPackage="com.yourapp"
      android:targetClass="com.yourapp.MainActivity">
      <parameter
        android:name="thing.name"
        android:key="query" />
    </intent>
  </capability>

  <!-- Media Capability -->
  <capability android:name="actions.intent.PLAY_MEDIA">
    <intent
      android:action="com.yourapp.PLAY_MEDIA"
      android:targetPackage="com.yourapp"
      android:targetClass="com.yourapp.MainActivity">
      <parameter
        android:name="media.name"
        android:key="mediaTitle" />
    </intent>
    <!-- Optional Slice for UI -->
    <slice
      android:targetClass="com.yourapp.MediaSliceProvider" />
  </capability>

  <!-- Productivity Capability -->
  <capability android:name="actions.intent.CREATE_THING">
    <intent
      android:action="com.yourapp.CREATE_TASK">
      <parameter
        android:name="thing.name"
        android:key="taskTitle" />
    </intent>
  </capability>

  <!-- Health/Exercise Capability -->
  <capability android:name="actions.intent.START_EXERCISE">
    <intent
      android:action="com.yourapp.START_WORKOUT">
      <parameter
        android:name="exercise.name"
        android:key="exerciseType" />
    </intent>
  </capability>
</shortcuts>
```

**Documentation**: [Built-in Intents Reference](https://developers.google.com/assistant/app/reference/built-in-intents)

#### 3. Deep Link Verification

The plugin configures deep link verification for App Actions:

- Adds `android:autoVerify="true"` to intent filters
- Generates `assetlinks.json` configuration
- Sets up web asset links

**Documentation**: [Android App Links](https://developer.android.com/training/app-links)

#### 4. Dynamic Shortcuts

For runtime shortcuts, the plugin sets up the ShortcutManager integration:

```kotlin
// Generated helper for dynamic shortcuts
val shortcut = ShortcutInfo.Builder(context, "search-shortcut")
    .setShortLabel("Search")
    .setLongLabel("Search with voice")
    .setIntent(Intent(Intent.ACTION_VIEW).apply {
        data = Uri.parse("yourapp://search")
    })
    .build()
```

**Documentation**: [ShortcutManager API](https://developer.android.com/guide/topics/ui/shortcuts)

## Example Configurations

### Minimal Configuration

```json
{
  "expo": {
    "plugins": ["expo-assistant"]
  }
}
```

### Search-Focused App

```json
{
  "expo": {
    "plugins": [
      [
        "expo-assistant",
        {
          "intents": ["search"],
          "ios": {
            "siriUsageDescription": "Use voice to search our database",
            "alternativeAppNames": ["Quick Search", "Search App"]
          },
          "android": {
            "appActionsTestUrl": "https://yourapp.com/test-actions"
          }
        }
      ]
    ]
  }
}
```

### Media Player App

```json
{
  "expo": {
    "plugins": [
      [
        "expo-assistant",
        {
          "intents": ["media"],
          "enableBackgroundExecution": true,
          "ios": {
            "requiresUnlock": false,
            "supportedIntentTypes": [
              "INPlayMediaIntent",
              "INPauseMediaIntent",
              "INSearchForMediaIntent"
            ]
          },
          "android": {
            "slicesEnabled": true
          }
        }
      ]
    ]
  }
}
```

### Productivity App with Tasks

```json
{
  "expo": {
    "plugins": [
      [
        "expo-assistant",
        {
          "intents": ["productivity", "search"],
          "ios": {
            "siriUsageDescription": "Create and manage tasks with your voice",
            "appGroups": ["group.com.yourapp.tasks"],
            "alternativeAppNames": ["Task Manager", "Todo App"]
          },
          "android": {
            "deepLinkVerification": true,
            "customVocabulary": {
              "terms": [
                {
                  "value": "standup",
                  "synonyms": ["daily standup", "morning meeting"]
                }
              ]
            }
          }
        }
      ]
    ]
  }
}
```

### Health & Fitness App

```json
{
  "expo": {
    "plugins": [
      [
        "expo-assistant",
        {
          "intents": ["health"],
          "enableBackgroundExecution": true,
          "ios": {
            "siriUsageDescription": "Start and track workouts with voice commands",
            "supportedIntentTypes": [
              "INStartWorkoutIntent",
              "INEndWorkoutIntent",
              "INPauseWorkoutIntent"
            ]
          },
          "android": {
            "appActionsTestUrl": "https://fitness.app/test-actions"
          }
        }
      ]
    ]
  }
}
```

## Development and Testing

### iOS Testing

1. **Simulator Testing**: Limited Siri testing via "Siri Intent Query" in scheme editor
2. **Device Testing**: Full Siri integration requires physical device
3. **TestFlight**: Test voice commands with beta testers

**Documentation**: [Testing SiriKit Intents](https://developer.apple.com/documentation/sirikit/debugging_an_intents_extension)

### Android Testing

1. **App Actions Test Tool**: Use Google's test tool for validation
2. **Assistant Settings**: Test on device via Assistant settings
3. **Play Console**: Submit for App Actions review

**Documentation**: [Test App Actions](https://developers.google.com/assistant/app/test-app-actions)

### Debug Mode

Enable debug logging to troubleshoot issues:

```json
{
  "expo": {
    "plugins": [
      [
        "expo-assistant",
        {
          "debugMode": true
        }
      ]
    ]
  }
}
```

## Permissions Handling

The plugin automatically configures required permissions, but you still need to request them at runtime:

```typescript
import { VoiceAssistant } from 'expo-assistant';

// Request permissions
const micStatus = await VoiceAssistant.requestMicrophonePermission();
const speechStatus = await VoiceAssistant.requestSpeechRecognitionPermission();

// Check capabilities
const capabilities = await VoiceAssistant.checkCapabilities();
```

## Build Requirements

### EAS Build

The plugin works seamlessly with EAS Build:

```json
{
  "build": {
    "production": {
      "ios": {
        "buildConfiguration": "Release"
      },
      "android": {
        "buildType": "release"
      }
    }
  }
}
```

### Bare Workflow

For bare workflow, run:

```bash
npx expo prebuild
```

This will apply all plugin configurations to your native projects.

## Troubleshooting

### Common iOS Issues

1. **"Siri not available"**: Ensure device has Siri enabled in Settings
2. **"Intent not recognized"**: Check Info.plist has correct NSUserActivityTypes
3. **"Extension not loading"**: Verify provisioning profiles include app groups

### Common Android Issues

1. **"App Actions not working"**: Verify shortcuts.xml is properly generated
2. **"Deep links failing"**: Check assetlinks.json on your domain
3. **"Voice not recognized"**: Ensure RECORD_AUDIO permission is granted

## Migration Guide

### From Manual Configuration

If you've previously configured voice features manually:

1. Remove manual Info.plist/AndroidManifest.xml entries
2. Delete custom Intent Extension targets
3. Add plugin configuration to app.json
4. Run `expo prebuild --clean`

### From Other Voice Libraries

1. Uninstall previous voice libraries
2. Install expo-assistant
3. Map previous configurations to plugin options
4. Update your voice intent implementations

## Additional Resources

- [Expo Config Plugins Documentation](https://docs.expo.dev/config-plugins/introduction/)
- [Apple SiriKit Documentation](https://developer.apple.com/documentation/sirikit)
- [Apple App Intents Documentation](https://developer.apple.com/documentation/appintents)
- [Google Assistant App Actions](https://developers.google.com/assistant/app)
- [Android Voice Interactions](https://developer.android.com/guide/topics/ui/voice-interactions)
- [expo-assistant GitHub Repository](https://github.com/your-org/expo-assistant)
- [expo-assistant Example App](https://github.com/your-org/expo-assistant/tree/main/example)

## Support

For issues, feature requests, or questions:

- [GitHub Issues](https://github.com/your-org/expo-assistant/issues)
- [Discord Community](https://discord.gg/expo-assistant)
- [Stack Overflow Tag](https://stackoverflow.com/questions/tagged/expo-assistant)