/**
 * Android config plugin for expo-assistant
 * Handles AndroidManifest.xml, shortcuts.xml, and App Actions setup
 */

import {
  ConfigPlugin,
  withAndroidManifest,
  withDangerousMod,
  AndroidConfig,
  ExportedConfigWithProps,
} from "@expo/config-plugins";
import * as fs from "fs";
import * as path from "path";

import { ExpoAssistantPluginConfig, INTENT_TYPE_MAPPINGS } from "./types";

export const withAndroidVoiceIntents: ConfigPlugin<
  ExpoAssistantPluginConfig
> = (config, props) => {
  config = withAndroidManifest(config, (config) => {
    return setAndroidManifest(config, props);
  });

  config = withDangerousMod(config, [
    "android",
    async (config) => {
      await createShortcutsXml(config, props);
      if (props.android?.slicesEnabled) {
        await createSliceProvider(config, props);
      }
      if (props.android?.voiceInteractionService) {
        await createVoiceInteractionService(config, props);
      }
      return config;
    },
  ]);

  return config;
};

function setAndroidManifest(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): ExportedConfigWithProps {
  const androidManifest = config.modResults;
  const mainApplication =
    AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);

  // Add permissions
  if (!androidManifest.manifest.permission) {
    androidManifest.manifest.permission = [];
  }

  const permissions = [
    "android.permission.RECORD_AUDIO",
    "android.permission.INTERNET",
    "android.permission.INSTALL_SHORTCUT",
  ];

  // Add Google Fit permissions if enabled
  if (props.enableGoogleFit) {
    permissions.push(
      "android.permission.ACTIVITY_RECOGNITION",
      "android.permission.ACCESS_FINE_LOCATION"
    );
  }

  // Add media session permissions if enabled
  if (props.enableMediaSession) {
    permissions.push(
      "android.permission.MEDIA_CONTENT_CONTROL",
      "android.permission.WAKE_LOCK"
    );
  }

  permissions.forEach((permission) => {
    if (
      !androidManifest.manifest["uses-permission"]?.find(
        (p: { $: { "android:name": string } }) =>
          p.$["android:name"] === permission
      )
    ) {
      if (!androidManifest.manifest["uses-permission"]) {
        androidManifest.manifest["uses-permission"] = [];
      }
      androidManifest.manifest["uses-permission"].push({
        $: {
          "android:name": permission,
        },
      });
    }
  });

  // Add metadata for App Actions
  const mainApp = mainApplication as Record<string, unknown>;
  if (!mainApp["meta-data"]) {
    mainApp["meta-data"] = [];
  }

  // Add shortcuts metadata
  const shortcutsMetadata = {
    $: {
      "android:name": "android.app.shortcuts",
      "android:resource": "@xml/shortcuts",
    },
  };

  if (
    !(mainApp["meta-data"] as { $: { "android:name": string } }[]).find(
      (m) => m.$["android:name"] === "android.app.shortcuts"
    )
  ) {
    (mainApp["meta-data"] as unknown[]).push(shortcutsMetadata);
  }

  // Add App Actions test URL if provided
  if (props.android?.appActionsTestUrl) {
    const testUrlMetadata = {
      $: {
        "android:name": "com.google.android.actions.APP_ACTIONS_TEST_URL",
        "android:value": props.android.appActionsTestUrl,
      },
    };

    if (
      !(mainApp["meta-data"] as { $: { "android:name": string } }[]).find(
        (m) =>
          m.$["android:name"] ===
          "com.google.android.actions.APP_ACTIONS_TEST_URL"
      )
    ) {
      (mainApp["meta-data"] as unknown[]).push(testUrlMetadata);
    }
  }

  // Add deep link intent filters with auto-verify
  const mainActivity =
    AndroidConfig.Manifest.getMainActivityOrThrow(androidManifest);

  if (props.android?.deepLinkVerification !== false) {
    const deepLinkFilter = {
      $: {
        "android:autoVerify": "true",
      },
      action: [
        {
          $: {
            "android:name": "android.intent.action.VIEW",
          },
        },
      ],
      category: [
        {
          $: {
            "android:name": "android.intent.category.DEFAULT",
          },
        },
        {
          $: {
            "android:name": "android.intent.category.BROWSABLE",
          },
        },
      ],
      data: [
        {
          $: {
            "android:scheme": "https",
            "android:host": config.scheme || "yourapp.com",
            "android:pathPrefix": "/action",
          },
        },
      ],
    };

    if (!mainActivity["intent-filter"]) {
      mainActivity["intent-filter"] = [];
    }

    // Check if deep link filter already exists
    const hasDeepLink = mainActivity["intent-filter"].some(
      (filter: Record<string, unknown>) =>
        (filter.data as { $: Record<string, string> }[])?.some(
          (d) => d.$["android:pathPrefix"] === "/action"
        )
    );

    if (!hasDeepLink) {
      mainActivity["intent-filter"].push(
        deepLinkFilter as Record<string, unknown>
      );
    }
  }

  // Add Voice Interaction Service if enabled
  if (props.android?.voiceInteractionService) {
    if (!mainApp.service) {
      mainApp.service = [];
    }

    const voiceService = {
      $: {
        "android:name": ".VoiceInteractionService",
        "android:permission": "android.permission.BIND_VOICE_INTERACTION",
      },
      "intent-filter": [
        {
          action: [
            {
              $: {
                "android:name": "android.service.voice.VoiceInteractionService",
              },
            },
          ],
        },
      ],
    };

    if (
      !(mainApp.service as { $: { "android:name": string } }[]).find(
        (s) => s.$["android:name"] === ".VoiceInteractionService"
      )
    ) {
      (mainApp.service as unknown[]).push(voiceService);
    }
  }

  // Add Slice Provider if enabled
  if (props.android?.slicesEnabled) {
    if (!mainApp.provider) {
      mainApp.provider = [];
    }

    const sliceProvider = {
      $: {
        "android:name": ".SliceProvider",
        "android:authorities": `${
          config.android?.package || "com.yourapp"
        }.sliceprovider`,
        "android:exported": "true",
      },
    };

    if (
      !(mainApp.provider as { $: { "android:name": string } }[]).find(
        (p) => p.$["android:name"] === ".SliceProvider"
      )
    ) {
      (mainApp.provider as unknown[]).push(sliceProvider);
    }
  }

  if (props.debugMode) {
    console.log("[expo-assistant] Android manifest configured");
  }

  return config;
}

async function createShortcutsXml(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): Promise<void> {
  const projectRoot = config.modRequest.projectRoot;
  const resPath = path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "res",
    "xml"
  );

  // Create xml directory if it doesn't exist
  if (!fs.existsSync(resPath)) {
    fs.mkdirSync(resPath, { recursive: true });
  }

  const packageName = config.android?.package || "com.yourapp";

  // Build shortcuts XML
  let shortcutsXml = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
`;

  // Add shortcuts based on intent categories
  if (props.intents) {
    props.intents.forEach((category) => {
      const capabilities = INTENT_TYPE_MAPPINGS.android[category];
      if (capabilities) {
        capabilities.forEach((capability: string) => {
          shortcutsXml += generateCapability(
            capability,
            packageName,
            category,
            props
          );
        });
      }
    });
  }

  // Add custom vocabulary if provided
  if (props.android?.customVocabulary?.terms) {
    shortcutsXml += `
  <!-- Custom Vocabulary -->
  <vocabulary>`;
    props.android.customVocabulary.terms.forEach((term) => {
      shortcutsXml += `
    <term android:value="${term.value}">`;
      term.synonyms.forEach((synonym) => {
        shortcutsXml += `
      <synonym android:value="${synonym}" />`;
      });
      shortcutsXml += `
    </term>`;
    });
    shortcutsXml += `
  </vocabulary>`;
  }

  shortcutsXml += `
</shortcuts>`;

  // Write shortcuts.xml
  fs.writeFileSync(path.join(resPath, "shortcuts.xml"), shortcutsXml);

  if (props.debugMode) {
    console.log(`[expo-assistant] shortcuts.xml created at ${resPath}`);
  }
}

function generateCapability(
  capability: string,
  packageName: string,
  category: string,
  props: ExpoAssistantPluginConfig
): string {
  const categoryActionMap: Record<string, string> = {
    "actions.intent.GET_THING": "SEARCH",
    "actions.intent.PLAY_MEDIA": "PLAY_MEDIA",
    "actions.intent.CREATE_THING": "CREATE_TASK",
    "actions.intent.START_EXERCISE": "START_WORKOUT",
    "actions.intent.SEND_MESSAGE": "SEND_MESSAGE",
  };

  const action = categoryActionMap[capability] || "CUSTOM_ACTION";
  const hasSlices = props.android?.slicesEnabled;

  let xml = `
  <capability android:name="${capability}">
    <intent
      android:action="${packageName}.${action}"
      android:targetPackage="${packageName}"
      android:targetClass="${packageName}.MainActivity">`;

  // Add parameters based on capability
  switch (capability) {
    case "actions.intent.GET_THING":
      xml += `
      <parameter
        android:name="thing.name"
        android:key="query" />`;
      break;
    case "actions.intent.PLAY_MEDIA":
      xml += `
      <parameter
        android:name="media.name"
        android:key="mediaTitle" />`;
      break;
    case "actions.intent.CREATE_THING":
      xml += `
      <parameter
        android:name="thing.name"
        android:key="taskTitle" />`;
      break;
    case "actions.intent.START_EXERCISE":
      xml += `
      <parameter
        android:name="exercise.name"
        android:key="exerciseType" />`;
      break;
    case "actions.intent.SEND_MESSAGE":
      xml += `
      <parameter
        android:name="message.recipient.name"
        android:key="recipient" />
      <parameter
        android:name="message.text"
        android:key="messageText" />`;
      break;
  }

  xml += `
    </intent>`;

  // Add Slice support if enabled
  if (hasSlices) {
    xml += `
    <slice
      android:targetClass="${packageName}.SliceProvider" />`;
  }

  xml += `
  </capability>`;

  return xml;
}

async function createSliceProvider(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): Promise<void> {
  const projectRoot = config.modRequest.projectRoot;
  const packageName = config.android?.package || "com.yourapp";
  const javaPath = path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "java",
    ...packageName.split(".")
  );

  if (!fs.existsSync(javaPath)) {
    fs.mkdirSync(javaPath, { recursive: true });
  }

  const sliceProviderKotlin = `package ${packageName}

import android.app.slice.Slice
import android.app.slice.SliceProvider
import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.app.PendingIntent
import androidx.core.graphics.drawable.IconCompat
import androidx.slice.Slice as AndroidXSlice
import androidx.slice.builders.ListBuilder
import androidx.slice.builders.SliceAction

class SliceProvider : SliceProvider() {

    override fun onCreateSliceProvider(): Boolean = true

    override fun onBindSlice(sliceUri: Uri): Slice? {
        val context = context ?: return null

        return when (sliceUri.path) {
            "/search" -> createSearchSlice(sliceUri)
            "/media" -> createMediaSlice(sliceUri)
            "/task" -> createTaskSlice(sliceUri)
            else -> null
        }
    }

    private fun createSearchSlice(sliceUri: Uri): Slice? {
        val context = context ?: return null

        val activityIntent = Intent(context, MainActivity::class.java).apply {
            action = "${packageName}.SEARCH"
        }

        val pendingIntent = PendingIntent.getActivity(
            context, 0, activityIntent, PendingIntent.FLAG_IMMUTABLE
        )

        return AndroidXSlice.Builder(context, sliceUri, AndroidXSlice.SPEC_INFINITY)
            .addAction(
                SliceAction.create(
                    pendingIntent,
                    IconCompat.createWithResource(context, android.R.drawable.ic_menu_search),
                    "Search"
                )
            )
            .addText("Voice Search", null, ListBuilder.HEADER_TITLE)
            .addText("Say what you're looking for", null, ListBuilder.HEADER_SUBTITLE)
            .build()
    }

    private fun createMediaSlice(sliceUri: Uri): Slice? {
        val context = context ?: return null

        val playIntent = Intent(context, MainActivity::class.java).apply {
            action = "${packageName}.PLAY_MEDIA"
        }

        val pendingIntent = PendingIntent.getActivity(
            context, 0, playIntent, PendingIntent.FLAG_IMMUTABLE
        )

        return AndroidXSlice.Builder(context, sliceUri, AndroidXSlice.SPEC_INFINITY)
            .addAction(
                SliceAction.create(
                    pendingIntent,
                    IconCompat.createWithResource(context, android.R.drawable.ic_media_play),
                    "Play"
                )
            )
            .addText("Media Control", null, ListBuilder.HEADER_TITLE)
            .build()
    }

    private fun createTaskSlice(sliceUri: Uri): Slice? {
        val context = context ?: return null

        val createIntent = Intent(context, MainActivity::class.java).apply {
            action = "${packageName}.CREATE_TASK"
        }

        val pendingIntent = PendingIntent.getActivity(
            context, 0, createIntent, PendingIntent.FLAG_IMMUTABLE
        )

        return AndroidXSlice.Builder(context, sliceUri, AndroidXSlice.SPEC_INFINITY)
            .addAction(
                SliceAction.create(
                    pendingIntent,
                    IconCompat.createWithResource(context, android.R.drawable.ic_menu_add),
                    "Add Task"
                )
            )
            .addText("Quick Task", null, ListBuilder.HEADER_TITLE)
            .build()
    }
}
`;

  fs.writeFileSync(
    path.join(javaPath, "SliceProvider.kt"),
    sliceProviderKotlin
  );

  if (props.debugMode) {
    console.log(`[expo-assistant] SliceProvider created at ${javaPath}`);
  }
}

async function createVoiceInteractionService(
  config: ExportedConfigWithProps,
  props: ExpoAssistantPluginConfig
): Promise<void> {
  const projectRoot = config.modRequest.projectRoot;
  const packageName = config.android?.package || "com.yourapp";
  const javaPath = path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "java",
    ...packageName.split(".")
  );

  if (!fs.existsSync(javaPath)) {
    fs.mkdirSync(javaPath, { recursive: true });
  }

  const voiceInteractionServiceKotlin = `package ${packageName}

import android.service.voice.VoiceInteractionService
import android.service.voice.VoiceInteractionSession
import android.os.Bundle
import android.content.Intent

class VoiceInteractionService : VoiceInteractionService() {

    override fun onReady() {
        super.onReady()
        // Service is ready to handle voice interactions
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Handle voice commands
        intent?.let {
            when (it.action) {
                "android.intent.action.VOICE_COMMAND" -> handleVoiceCommand(it)
            }
        }
        return super.onStartCommand(intent, flags, startId)
    }

    private fun handleVoiceCommand(intent: Intent) {
        val query = intent.getStringExtra("android.intent.extra.TEXT")

        // Process voice command
        query?.let {
            when {
                it.contains("search", ignoreCase = true) -> handleSearch(it)
                it.contains("play", ignoreCase = true) -> handlePlayMedia(it)
                it.contains("task", ignoreCase = true) -> handleCreateTask(it)
                it.contains("workout", ignoreCase = true) -> handleStartWorkout(it)
                else -> handleGenericCommand(it)
            }
        }
    }

    private fun handleSearch(query: String) {
        val searchIntent = Intent(this, MainActivity::class.java).apply {
            action = "${packageName}.SEARCH"
            putExtra("query", query)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(searchIntent)
    }

    private fun handlePlayMedia(query: String) {
        val mediaIntent = Intent(this, MainActivity::class.java).apply {
            action = "${packageName}.PLAY_MEDIA"
            putExtra("mediaTitle", query)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(mediaIntent)
    }

    private fun handleCreateTask(query: String) {
        val taskIntent = Intent(this, MainActivity::class.java).apply {
            action = "${packageName}.CREATE_TASK"
            putExtra("taskTitle", query)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(taskIntent)
    }

    private fun handleStartWorkout(query: String) {
        val workoutIntent = Intent(this, MainActivity::class.java).apply {
            action = "${packageName}.START_WORKOUT"
            putExtra("exerciseType", query)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(workoutIntent)
    }

    private fun handleGenericCommand(query: String) {
        val genericIntent = Intent(this, MainActivity::class.java).apply {
            action = "${packageName}.VOICE_COMMAND"
            putExtra("command", query)
            flags = Intent.FLAG_ACTIVITY_NEW_TASK
        }
        startActivity(genericIntent)
    }
}

class VoiceSession(service: VoiceInteractionService) : VoiceInteractionSession(service) {

    override fun onHandleAssist(
        data: Bundle?,
        structure: AssistStructure?,
        content: AssistContent?
    ) {
        // Handle assist data
        super.onHandleAssist(data, structure, content)
    }

    override fun onHandleVoiceCommand(intent: Intent) {
        // Handle voice commands in session
        super.onHandleVoiceCommand(intent)
    }
}
`;

  fs.writeFileSync(
    path.join(javaPath, "VoiceInteractionService.kt"),
    voiceInteractionServiceKotlin
  );

  if (props.debugMode) {
    console.log(
      `[expo-assistant] VoiceInteractionService created at ${javaPath}`
    );
  }
}
