import AppIntents

/// Bridge from the iOS App Intents framework into `ExpoAssistantModule`.
///
/// This file ships the `GenericVoiceIntent` that every voice shortcut
/// declared by the developer routes through. The actual list of
/// shortcuts and the `AppShortcutsProvider` conformance live in
/// `AppShortcutsBridge.generated.swift`, written into the example app's
/// iOS target by the config plugin at prebuild time
/// (`plugin/src/withIOSVoiceIntents.ts` → `withGeneratedAppShortcuts`).
///
/// Why split: an `AppShortcutsProvider` lives in the app target so iOS
/// can scan it at launch. The pod can't be a `AppShortcutsProvider`
/// directly — only one provider per app is honored. Keeping
/// `GenericVoiceIntent` in the pod and generating the provider per app
/// lets each developer's `app.json` drive their own shortcut list while
/// the pod stays generic.
///
/// When a shortcut fires, `GenericVoiceIntent.perform()` calls back
/// into the live `ExpoAssistantModule` singleton via
/// `emitIntent(id:parameters:)`, which `sendEvent`s `onIntentInvoked`
/// to JS. The JS-side `VoiceAssistant.handleIntentInvoked` then routes
/// to the registered handler — see `AGENTS.md` for the push-only
/// invocation model.

/// Single generic `AppIntent` that all expo-assistant-declared voice
/// shortcuts route through. The runtime distinguishes which intent fired
/// by reading `intentId`. Parameters travel as discrete `@Parameter`s on
/// this struct; for now only an optional `query` is exposed (most
/// invocations carry at most one free-form string). Richer typed
/// parameter shapes are deferred until a real need surfaces (see issue
/// #19 for the INInteraction-based upgrade path that would also benefit
/// from typed intents).
@available(iOS 16.0, *)
public struct GenericVoiceIntent: AppIntent {
    public static var title: LocalizedStringResource = "Voice Intent"

    // Drives the Shortcuts.app editor preview AND the `needsValue` flow
    // when an AppShortcut tile is tapped without a bound query.
    // Without a parameterSummary that references $query, iOS treats the
    // optional query as "not requested" and skips it silently — which is
    // why tap-to-run produced nil before this was added.
    public static var parameterSummary: some ParameterSummary {
        Summary("Run \(\.$intentId)") {
            \.$query
        }
    }

    @Parameter(title: "Intent ID")
    public var intentId: String

    // `requestValueDialog` is what iOS speaks (or shows) when it needs
    // a value and has none — triggered when the phrase template includes
    // \(\.$query) but the spoken phrase didn't fill it, OR when the
    // AppShortcut tile is tapped from Library/Spotlight without binding.
    @Parameter(
        title: "Query",
        requestValueDialog: "What would you like to search for?"
    )
    public var query: String?

    public init() {}

    public init(intentId: String, query: String? = nil) {
        self.intentId = intentId
        self.query = query
    }

    public func perform() async throws -> some IntentResult {
        await MainActor.run {
            ExpoAssistantModule.shared?.emitIntent(
                id: intentId,
                parameters: [
                    "query": query as Any
                ]
            )
        }
        return .result()
    }
}
