# Runbook: Compose expo-assistant with expo-widgets

End-to-end guide for shipping a **configurable iOS widget** (home screen or lock screen) whose configuration sheet is driven by App Intents. expo-widgets owns the widget extension and the visual surface; expo-assistant owns the `WidgetConfigurationIntent` that drives what the widget displays.

Read `plugin/SCOPE.md` first if you're unsure which package owns what.

## Prerequisites

- Expo SDK 54+, iOS deployment target 16.0+ (17.0+ for interactive widgets)
- `expo-assistant` configured with at least the basics from `runbook/integrate-app-shortcut.md`
- A real use case for *configurable* widgets — if your widget shows the same thing for everyone, you don't need expo-assistant at all; use expo-widgets standalone

## 1. Install both packages

```bash
bun add expo-assistant expo-widgets
```

expo-widgets is **not** a peer dependency of expo-assistant. We don't import from it. The integration is purely via a shared `kind` string and a Swift type your widget references. The plugin will throw at prebuild with a helpful error if you declare `ios.widgetConfigurations[]` without expo-widgets installed.

## 2. Declare the widget in expo-widgets

```jsonc
// app.json
"plugins": [
  ["expo-widgets", {
    "widgets": [{
      "kind": "UpcomingMeetings",
      "supportedFamilies": ["systemSmall", "systemMedium"],
      "groupIdentifier": "group.com.example.myapp.widgets"
    }]
  }]
]
```

This produces the Widget Extension target, the `UpcomingMeetingsWidget: Widget` Swift body, App Group entitlements on both targets, and the JS `updateSnapshot()` / `updateTimeline()` APIs.

## 3. Declare the configuration intent in expo-assistant

```jsonc
// app.json — adjacent to the expo-widgets entry
"plugins": [
  ["expo-widgets", { /* as above */ }],
  ["expo-assistant", {
    "ios": {
      "siriUsageDescription": "Configure meeting widget",
      "entities": [{
        "name": "Calendar",
        "displayProperty": "title",
        "properties": [{ "name": "title", "type": "string" }]
      }],
      "widgetConfigurations": [{
        "kind": "UpcomingMeetings",                    // MUST match expo-widgets kind
        "title": "Upcoming Meetings",
        "description": "Show meetings from a specific calendar",
        "parameters": [
          { "name": "calendar", "type": "entity:Calendar", "title": "Calendar" },
          { "name": "count",    "type": "number",          "title": "Show next", "default": 5 }
        ]
      }]
    }
  }]
]
```

Critical: the `kind` string must match byte-for-byte across the two plugins. The Swift type expo-assistant emits is named `<PascalCaseKind>Config` (here, `UpcomingMeetingsConfig`); expo-widgets' generated `Widget` body references it as `intent: UpcomingMeetingsConfig.self`.

## 4. Prebuild

```bash
bunx expo prebuild --platform ios --clean
```

Generates:

- `ios/<YourApp>/AppShortcutsBridge.generated.swift` — contains `UpcomingMeetingsConfig: WidgetConfigurationIntent`, `CalendarEntity: AppEntity`, `CalendarQuery: EntityStringQuery`
- `ios/<YourApp>Widgets/...` — expo-widgets' generated Widget Extension scaffolding

## 5. Register the entity resolver in JS

The configuration sheet needs to populate the Calendar picker. expo-assistant's `EntityStringQuery` bridge proxies through your JS resolver:

```ts
import { VoiceAssistant, type EntityRecord } from 'expo-assistant';

type Calendar = EntityRecord & { id: string; title: string };

const va = await VoiceAssistant.initialize();

va.registerEntityResolver<Calendar>('Calendar', {
  matching: async (search) => {
    const all = await loadCalendarsFromStore();
    const q = search.toLowerCase();
    return q ? all.filter((c) => c.title.toLowerCase().includes(q)) : all;
  },
  resolve: async (ids) => {
    const all = await loadCalendarsFromStore();
    return all.filter((c) => ids.includes(c.id));
  },
  suggested: async () => (await loadCalendarsFromStore()).slice(0, 3),
});
```

Same shape as any other entity resolver in expo-assistant. The widget configuration sheet runs in iOS's process when the user adds or edits the widget — your app's JS resolver is queried via the bridge.

Background-state caveat: when the user adds a widget while your app isn't running, the JS resolver isn't alive and the picker times out empty. This is the same constraint as any AppEntity scan; #41 (snapshot-store mode) fixes it for both surfaces.

## 6. Push timeline data via expo-widgets

When the user picks `{ calendar: "Work", count: 3 }`, your widget needs to display 3 meetings from the Work calendar. That data flow runs through expo-widgets, not expo-assistant:

```ts
import * as Widgets from 'expo-widgets';

async function refreshWidgetForConfig(config: { calendarId: string; count: number }) {
  const meetings = await fetchMeetings(config.calendarId, { limit: config.count });
  await Widgets.updateSnapshot('UpcomingMeetings', {
    data: { meetings: meetings.map((m) => ({ title: m.title, time: m.startISO })) },
  });
}
```

The widget body (generated by expo-widgets) reads from the shared App Group container and renders.

## 7. Verify

- [ ] `bunx expo run:ios` succeeds
- [ ] In Springboard, long-press home screen → `+` → search for your app — the widget appears in the gallery
- [ ] Tap "Add Widget" → the configuration sheet shows the Calendar picker and the Count stepper
- [ ] Pick a calendar (autocomplete populated by your JS resolver) → confirm
- [ ] The widget renders with the data your JS pushed via `Widgets.updateSnapshot`

If the picker is empty: app probably isn't running. Background-state entity scans time out; foreground the app and re-open the configuration sheet.

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Plugin throws `widgetConfigurations declared but expo-widgets not installed` | Missing the `expo-widgets` package | `bun add expo-widgets` |
| Build error `cannot find UpcomingMeetingsConfig` | `kind` mismatch between the two plugin configs | Make the strings byte-for-byte equal across both `app.json` entries |
| Configuration sheet shows but Calendar picker is empty | JS resolver isn't responding (app backgrounded, or resolver not registered) | Register the resolver in your app's startup path; for backgrounded scans, see #41 |
| Widget renders but never updates | You aren't calling `Widgets.updateSnapshot` / `Widgets.updateTimeline` | Push data from JS after the user changes config |
| Picker doesn't filter as you type | `matching(search)` ignoring the search string | Filter inside the resolver — iOS just forwards the typed text |

## Scope reminder

- **expo-assistant** owns: the `WidgetConfigurationIntent` struct, `AppEntity` + `EntityStringQuery` for typed pickers, the JS-side entity resolver bridge
- **expo-widgets** owns: the Widget Extension target, the `Widget` / `TimelineProvider` / SwiftUI body, App Group entitlements, the timeline-data JS API
- **You** own: the JS resolver implementation, the data you push into the widget snapshot, the styling of the widget body

When in doubt, ask "is this about the *intent that configures the widget* (us) or the *widget itself* (expo-widgets)?"
