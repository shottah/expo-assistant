# Scope: what expo-assistant does and doesn't do

This doc fixes the boundary of the package so contributors and adopters have a single source of truth for "should this feature live here, or in a different package?" Read this before filing a feature issue, expanding the plugin surface, or composing expo-assistant with another Expo package.

## The boundary, in one line

**expo-assistant owns the App Intents *invocation* surface.** Other packages own *presentation* surfaces. The Apple App Intents framework spans both; the responsibility split between packages follows the same seam.

| Concern | Owner | Why |
|---|---|---|
| Declaring an `AppIntent`-conforming Swift type so the OS can scan and invoke it | **expo-assistant** | This is the core capability — codegen + cross-platform handler bridge |
| Rendering UI that displays app data on the home screen, lock screen, or Dynamic Island | `expo-widgets` | Their plugin scaffolds the Widget Extension target + `Widget` body + SwiftUI views + timeline delivery |
| Owning the active audio session and rendering the lock-screen Now Playing tile | `expo-av` / `expo-audio` | Audio output is their domain; we provide the intent that *starts/pauses* the audio |
| Push notification infrastructure | `expo-notifications` | Notifications aren't intents |
| Mic input, speech recognition, TTS | `expo-speech` / `expo-av` | We trigger via voice; we don't capture voice |

When in doubt, ask: "is the user asking us to **declare an intent the OS can invoke** (with cross-platform handler routing back to JS), or to **render content / produce sound / send a notification**?" The first is us; the second is somewhere else.

---

## MUST DO

The package generates and binds AppIntent declarations on iOS and App Action shortcuts on Android, then routes the OS's invocations into JS handlers. Concretely:

| # | Surface | Status |
|---|---|---|
| 1 | iOS `AppShortcutsProvider` + `AppShortcut` phrase scanning (Siri / Spotlight / Shortcuts.app / Library) | shipped |
| 2 | iOS `AppEnum` + `AppEntity` codegen + `EntityStringQuery` bridge | shipped |
| 3 | Android `shortcuts.xml` + capability binding + `pushDynamicShortcut` donation | in progress (#17 / #18) |
| 4 | Unified JS API: `registerIntent`, `registerEntityResolver`, `donateIntent`, `onIntentInvoked`, `respondToEntityQuery`, `updateAppShortcutParameters` | shipped |
| 5 | Result presentation surfaces (`ProvidesDialog`, `ShowsSnippetView`, `OpensIntent`, confirmation, disambiguation) | #31 |
| 6 | `AssistantSchemas` conformance for Apple Intelligence | #30 (blocked on #35 research) |
| 7 | `AudioPlaybackIntent` codegen — **gated** on the app needing to own the active audio session with custom now-playing metadata | #32 |
| 8 | `ControlConfigurationIntent` codegen — emit the Swift intent struct + handler bridge for iOS 18 Control Center / Lock Screen / Action Button | #34 (rescoped) |
| 9 | `WidgetConfigurationIntent` codegen — emit **only the Swift intent struct** that a separate Widget Extension consumes | #33 (rescoped) |
| 10 | `EntityResolver` plumbing (async-with-timeout today, snapshot-store mode planned) | shipped + #41 |

The common shape: we generate Swift code that conforms to an App Intents protocol, register it so the OS scans it, and route invocations back to JS via the existing `onIntentInvoked` event. Anything outside that shape isn't ours.

---

## MUST NOT DO

| # | Surface | Owner | Reason |
|---|---|---|---|
| 1 | Widget Extension target scaffolding (pbxproj target creation, Info.plist, entitlements for the widget process) | `expo-widgets` | Their plugin already does this; duplicating would create two competing extension targets |
| 2 | `Widget` / `TimelineProvider` / SwiftUI view bodies | `expo-widgets` | The visual layer is their domain |
| 3 | `updateSnapshot()` / `updateTimeline()` JS APIs for delivering widget data | `expo-widgets` | Cross-process data delivery for widgets is theirs |
| 4 | Live Activities (`ActivityKit`) — start/update/end + Dynamic Island layouts | `expo-widgets` | Live Activities are a widget-presentation API, not an invocation API |
| 5 | Widget-side push tokens / push-to-start tokens | `expo-widgets` | Widget update transport is theirs |
| 6 | App Group entitlement *for widget-side shared storage* | `expo-widgets` | They own the widget process; they configure its entitlement. We may add App Groups for our own intent-handler IPC (e.g. #41 snapshot-store), but not for the widget's data channel |
| 7 | `MPNowPlayingInfoCenter` / `AVAudioSession` activation / lock-screen audio metadata rendering | `expo-av` / `expo-audio` | Audio session ownership is their domain. We emit the intent that *triggers* playback; they own what plays |
| 8 | Push notifications | `expo-notifications` | Different surface entirely |
| 9 | Microphone capture, speech recognition, TTS output | `expo-speech` / `expo-av` | We *receive* OS-routed invocations; we don't capture or synthesize voice ourselves |
| 10 | UI for parameter pickers, confirmation sheets, error-recovery flows beyond what AppIntents auto-renders | OS | The framework draws these from `@Parameter` declarations + `requestValueDialog` — we never paint pixels |
| 11 | watchOS complications | nobody (out of scope for now) | Could be a future expansion; not today |
| 12 | Generic config-plugin utilities (`mergeContents`, `WarningAggregator`, `IOSConfig.XcodeUtils.*`) | `@expo/config-plugins` | We consume; we don't reimplement |

---

## Integration patterns

### With expo-widgets (the most common compose case)

The seam is the `kind` string. `expo-widgets` declares a widget kind in its plugin config; `expo-assistant` declares a matching `widgetConfigurations[]` entry with the same kind name. We emit a Swift `WidgetConfigurationIntent` struct named `<Kind>Config`. Their generated `Widget` body uses our struct as the `intent:` argument to `AppIntentConfiguration`.

```jsonc
// app.json
"plugins": [
  ["expo-widgets", {
    "widgets": [{
      "kind": "UpcomingMeetings",
      "supportedFamilies": ["systemSmall", "systemMedium"]
    }]
  }],
  ["expo-assistant", {
    "ios": {
      "widgetConfigurations": [{
        "kind": "UpcomingMeetings",                          // must match expo-widgets kind
        "title": "Upcoming Meetings",
        "parameters": [
          { "name": "calendar", "type": "entity:Calendar", "title": "Calendar" },
          { "name": "count",    "type": "number",          "title": "Count", "default": 5 }
        ]
      }],
      "entities": [
        { "name": "Calendar", "displayProperty": "title",
          "properties": [{ "name": "title", "type": "string" }] }
      ]
    }
  }]
]
```

End state:
- `expo-widgets` produces the Widget Extension, the `UpcomingMeetingsWidget: Widget` body, the timeline provider, and the JS `updateSnapshot()` API
- `expo-assistant` produces `UpcomingMeetingsConfig: WidgetConfigurationIntent`, the `CalendarEntity: AppEntity` + `CalendarQuery: EntityStringQuery`, and routes calendar selection back to JS via the existing `registerEntityResolver` flow
- The user writes a JS handler for the intent (gets `{ calendar, count }`) and a separate JS call into expo-widgets to push timeline data

### Peer dependency policy

**We do NOT declare `expo-widgets` as a peer dependency.** Reasons:

- Our code doesn't import from it — the integration is purely via a shared `kind` string and a Swift type the user's widget references
- expo-widgets is beta; pinning every expo-assistant adopter to a specific version would harm adoption
- Most expo-assistant users only want voice shortcuts and don't need widgets

The pattern we use instead: **prebuild-time validation.** When `ios.widgetConfigurations[]` is declared, the plugin checks the host app's `node_modules` for `expo-widgets`. If absent, throw a `pluginError` pointing the developer at install instructions. Zero runtime coupling, helpful failure at the moment of misuse.

The same policy applies to any future "we emit an intent struct that another package's extension consumes" compose case (e.g. #34 ControlConfigurationIntent + a future expo-widgets Control Widget surface).

### With expo-av / expo-audio (#32 AudioPlaybackIntent)

The discriminator: **who owns the lock-screen Now Playing tile while audio is playing?**

- If a generic audio package (`expo-av`, `expo-audio`) owns the active `AVAudioSession` and updates `MPNowPlayingInfoCenter` — they own playback, we just trigger via a regular `AppIntent` and pass control back to JS, which calls into the audio package. **No `AudioPlaybackIntent` needed.**
- If the developer needs *us* to own the session — to render custom metadata, custom scrub semantics, custom queue control, custom lifecycle — that's when `AudioPlaybackIntent` matters. Gated implementation; opt-in.

See issue #32 for the gating rationale and the 5 example surfaces that work *without* it.

### With expo-notifications

No integration. Push notifications and AppIntents are different OS subsystems. If a feature feels like it needs both ("send a notification, then make a tap fire an intent"), that's a JS-layer composition the app developer writes — `expo-notifications` delivers the notification, the tap deep-links to a screen that calls the intent's handler directly.

---

## How to update this doc

When a new Expo first-party package ships that overlaps with our scope, or when a new Apple framework changes the seam:

1. Add a new row to `MUST DO` or `MUST NOT DO` (or move an existing row across the line).
2. If a new compose pattern emerges, add an "Integration patterns" subsection with a concrete `app.json` example.
3. Update the affected issue(s) — rescope acceptance criteria, add a `## Scope boundary` note pointing here.
4. Add a brief decision-log line to `.plan/07-plugin-audit.md` § Decision log so the audit trail captures *when* the boundary moved and *why*.

Scope decisions are reversible but expensive — we shipped #33 acceptance criteria once already assuming we'd own widget extension scaffolding, then rescoped after expo-widgets beta landed. Document the moves so the next contributor doesn't relitigate them.
