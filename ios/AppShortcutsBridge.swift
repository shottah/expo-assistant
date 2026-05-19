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

    @Parameter(title: "Intent ID")
    public var intentId: String

    @Parameter(title: "Query")
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
