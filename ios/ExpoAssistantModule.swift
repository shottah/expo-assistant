import ExpoModulesCore
import Intents
import Speech
import AVFoundation
#if canImport(AppIntents)
import AppIntents
#endif

@available(iOS 13.0, *)
public class ExpoAssistantModule: Module {
    // `internal` so `@testable import ExpoAssistant` can swap mocks and
    // inspect state. Still hidden from external consumers.
    internal var speechRecognizer: SpeechRecognizerProtocol = SpeechRecognizer()
    internal var intentHandler: IntentHandlerProtocol = IntentHandler()
    internal var registeredIntents: Set<String> = []
    internal var config: VoiceAssistantConfig?
    internal var isInitialized = false
    internal var isBackgroundProcessingEnabled = false
    internal var debugMode = false

    var onEventReceived: ((VoiceEvent) -> Void)?

    /// Bridge that generated `<Name>Query: EntityStringQuery` structs
    /// proxy through. Holds pending continuations keyed by requestId so
    /// the JS resolver can respond out-of-band via the
    /// `respondToEntityQuery` async function. Lazy so the back-reference
    /// is set after `self` is fully constructed. See #28 + the
    /// async-with-timeout architecture decision; the snapshot-store
    /// follow-up (#41) will extend this with a system-process-readable
    /// cache for backgrounded scanning.
    public lazy var entityResolver: EntityResolver = EntityResolver(module: self)

    /// Singleton handle so the AppShortcuts bridge (declared as a
    /// non-Module-context struct via `AppShortcutsProvider`) can call
    /// back into the live module to emit invocation events. Weak so the
    /// expo runtime can deinit the module normally.
    public static weak var shared: ExpoAssistantModule?

    public func definition() -> ModuleDefinition {
        Name("ExpoAssistant")

        Events("onIntentInvoked", "onIntentCompleted", "onIntentFailed", "onEntityQuery")

        OnCreate {
            ExpoAssistantModule.shared = self
        }

        AsyncFunction("initialize") { (config: [String: Any]?, promise: Promise) in
            self.initializeModule(config: config) { error in
                if let error = error {
                    promise.reject("INIT_FAILED", error.localizedDescription)
                } else {
                    promise.resolve()
                }
            }
        }

        AsyncFunction("registerIntent") { (config: [String: Any], promise: Promise) in
            guard let intentId = config["id"] as? String else {
                promise.reject("INVALID_CONFIG", "Intent ID is required")
                return
            }

            if self.registeredIntents.contains(intentId) {
                promise.reject("ALREADY_REGISTERED", "Intent \(intentId) is already registered")
                return
            }

            self.registerIntentInternal(config: config) { error in
                if let error = error {
                    promise.reject("REGISTER_FAILED", error.localizedDescription)
                } else {
                    self.registeredIntents.insert(intentId)
                    promise.resolve()
                }
            }
        }

        AsyncFunction("unregisterIntent") { (intentId: String, promise: Promise) in
            if !self.registeredIntents.contains(intentId) {
                promise.reject("NOT_FOUND", "Intent \(intentId) not found")
                return
            }

            self.registeredIntents.remove(intentId)
            promise.resolve()
        }

        AsyncFunction("donateIntent") { (intentId: String, parameters: [String: Any], promise: Promise) in
            self.donateIntentInternal(intentId: intentId, parameters: parameters) { error in
                if let error = error {
                    promise.reject("DONATE_FAILED", error.localizedDescription)
                } else {
                    promise.resolve()
                }
            }
        }

        AsyncFunction("requestMicrophonePermission") { (promise: Promise) in
            self.requestMicrophonePermissionInternal { status in
                promise.resolve(status.rawValue)
            }
        }

        AsyncFunction("requestSpeechRecognitionPermission") { (promise: Promise) in
            self.requestSpeechRecognitionPermissionInternal { status in
                promise.resolve(status.rawValue)
            }
        }

        AsyncFunction("checkCapabilities") { (promise: Promise) in
            self.checkCapabilitiesInternal { capabilities in
                promise.resolve(capabilities)
            }
        }

        AsyncFunction("enableSiriKit") { (promise: Promise) in
            self.enableSiriKitInternal { error in
                if let error = error {
                    promise.reject("ENABLE_SIRIKIT_FAILED", error.localizedDescription)
                } else {
                    promise.resolve()
                }
            }
        }

        AsyncFunction("enableBackgroundProcessing") { (promise: Promise) in
            self.isBackgroundProcessingEnabled = true
            promise.resolve()
        }

        AsyncFunction("enableCustomUI") { (promise: Promise) in
            promise.resolve()
        }

        AsyncFunction("getPlatform") { () -> String in
            return "ios"
        }

        AsyncFunction("getLocale") { () -> String in
            return Locale.current.identifier
        }

        AsyncFunction("setDebugMode") { (enabled: Bool, promise: Promise) in
            self.debugMode = enabled
            promise.resolve()
        }

        AsyncFunction("enableAppActions") { (promise: Promise) in
            promise.resolve()
        }

        // JS-side callback for entity query results. The generated
        // `<Name>Query: EntityStringQuery` Swift structs call into
        // `entityResolver.resolve(...)`, which fires `onEntityQuery` to
        // JS with a unique requestId; the JS resolver computes its
        // matches and calls back via this AsyncFunction. The native
        // resolver finds the pending continuation by requestId and
        // resumes it. Late responses (after the 1s timeout already
        // resolved the continuation) are silently dropped — see
        // EntityResolver.resolveIfPending.
        AsyncFunction("respondToEntityQuery") { (requestId: String, entities: [[String: Any]]) -> Void in
            self.entityResolver.resolveIfPending(requestId: requestId, with: entities)
        }

        // JS signals iOS to re-query the generated AppShortcutsProvider's
        // entity-typed parameters. iOS then calls `suggestedEntities()`
        // on each associated EntityStringQuery — which round-trips
        // through our resolver bridge to JS. Necessary because linkd
        // ingests the metadata bundle at install time, but our JS
        // resolver isn't alive yet then, so the entity phrase slots are
        // rejected on the install scan. After JS has registered its
        // resolvers, calling this re-validates the slots.
        //
        // The generated AppShortcutsProvider lives in the app target
        // (outside the pod's module), so the pod can't call its static
        // `updateAppShortcutParameters()` directly. The plugin codegen
        // emits an `@objc` helper class on the app side that the pod
        // looks up dynamically here.
        //
        // Apple ref:
        // https://developer.apple.com/documentation/appintents/appshortcutsprovider/updateappshortcutparameters()
        AsyncFunction("updateAppShortcutParameters") { (promise: Promise) in
            if #available(iOS 16.4, *),
               let bundleId = Bundle.main.bundleIdentifier {
                let className = "\(bundleId).ExpoAssistantParametersRefresher"
                if let cls = NSClassFromString(className) as? NSObject.Type {
                    _ = cls.perform(NSSelectorFromString("refresh"))
                }
            }
            promise.resolve()
        }
    }

    // MARK: - Internal Methods

    internal func initializeModule(config: [String: Any]?, completion: @escaping (Error?) -> Void) {
        if let config = config {
            self.config = VoiceAssistantConfig(from: config)
        }

        speechRecognizer.initialize { error in
            if let error = error {
                completion(error)
            } else {
                self.isInitialized = true
                completion(nil)
            }
        }
    }

    private func registerIntentInternal(config: [String: Any], completion: @escaping (Error?) -> Void) {
        guard isInitialized else {
            completion(NSError(domain: "ExpoAssistant", code: 1000, userInfo: [NSLocalizedDescriptionKey: "Module not initialized"]))
            return
        }

        if #available(iOS 16.0, *),
           let platforms = config["platforms"] as? [String: Any],
           let iosConfig = platforms["ios"] as? [String: Any],
           iosConfig["appIntentSchema"] != nil {
            registerAppIntent(config: config, completion: completion)
        } else {
            registerSiriKitIntent(config: config, completion: completion)
        }
    }

    @available(iOS 16.0, *)
    private func registerAppIntent(config: [String: Any], completion: @escaping (Error?) -> Void) {
        guard let intentId = config["id"] as? String else {
            completion(NSError(domain: "ExpoAssistant", code: 1001, userInfo: [NSLocalizedDescriptionKey: "Invalid intent configuration"]))
            return
        }

        intentHandler.registerAppIntent(intentId) { error in
            completion(error)
        }
    }

    private func registerSiriKitIntent(config: [String: Any], completion: @escaping (Error?) -> Void) {
        completion(nil)
    }

    internal func donateIntentInternal(intentId: String, parameters: [String: Any], completion: @escaping (Error?) -> Void) {
        intentHandler.donate(intentId: intentId, parameters: parameters, completion: completion)
    }

    internal func requestMicrophonePermissionInternal(completion: @escaping (PermissionStatus) -> Void) {
        speechRecognizer.requestMicrophonePermission(completion: completion)
    }

    internal func requestSpeechRecognitionPermissionInternal(completion: @escaping (PermissionStatus) -> Void) {
        speechRecognizer.requestSpeechPermission(completion: completion)
    }

    internal func checkCapabilitiesInternal(completion: @escaping ([String: Any]) -> Void) {
        var capabilities: [String: Any] = [:]

        var iosCapabilities: [String: Any] = [
            "speechRecognitionAvailable": SFSpeechRecognizer.authorizationStatus() == .authorized,
            "siriKitSupported": true,
            "appIntentsSupported": false,
            "availableDomains": getAvailableSiriDomains()
        ]

        if #available(iOS 16.0, *) {
            iosCapabilities["appIntentsSupported"] = true
        }

        capabilities["ios"] = iosCapabilities
        completion(capabilities)
    }

    private func getAvailableSiriDomains() -> [String] {
        return [
            "INSearchForMessagesIntent",
            "INSendMessageIntent",
            "INStartAudioCallIntent",
            "INStartVideoCallIntent",
            "INPlayMediaIntent",
            "INStartWorkoutIntent",
            "INEndWorkoutIntent"
        ]
    }

    private func enableSiriKitInternal(completion: @escaping (Error?) -> Void) {
        completion(nil)
    }

    func handleSiriIntent(_ intent: INIntent, completion: @escaping (INIntentResponse?) -> Void) {
        intentHandler.handleIntent(intent, completion: completion)
    }

    func emitEvent(type: VoiceEventType, intentId: String, data: [String: Any]? = nil, error: Error? = nil) {
        let event = VoiceEvent(type: type, intentId: intentId, data: data, error: error)

        onEventReceived?(event)

        switch type {
        case .intentInvoked:
            sendEvent("onIntentInvoked", ["intentId": intentId, "data": data ?? [:]])
        case .intentCompleted:
            sendEvent("onIntentCompleted", ["intentId": intentId, "data": data ?? [:]])
        case .intentFailed:
            sendEvent("onIntentFailed", ["intentId": intentId, "error": error?.localizedDescription ?? "Unknown error"])
        }
    }

    /// Convenience entry point for the AppShortcuts bridge: a voice trigger
    /// fired `GenericVoiceIntent.perform()` or a generated typed
    /// `<Name>Intent.perform()` (post-#25), which calls this on the
    /// singleton. `public` so generated AppIntent structs in the app
    /// target — which live outside the pod's module boundary — can reach
    /// it. We thin-wrap `emitEvent` so the bridge doesn't need to know
    /// about `VoiceEventType` internals.
    public func emitIntent(id: String, parameters: [String: Any]) {
        emitEvent(type: .intentInvoked, intentId: id, data: parameters)
    }
}

// MARK: - Supporting Types

struct VoiceAssistantConfig {
    let enableBackgroundExecution: Bool
    let debugMode: Bool
    let enableCustomUI: Bool
    let enableMediaSession: Bool

    init(from dictionary: [String: Any]) {
        self.enableBackgroundExecution = dictionary["enableBackgroundExecution"] as? Bool ?? false
        self.debugMode = dictionary["debugMode"] as? Bool ?? false
        self.enableCustomUI = dictionary["enableCustomUI"] as? Bool ?? false
        self.enableMediaSession = dictionary["enableMediaSession"] as? Bool ?? false
    }
}

enum PermissionStatus: String {
    case granted = "granted"
    case denied = "denied"
    case undetermined = "undetermined"
    case unavailable = "unavailable"
}

enum VoiceEventType {
    case intentInvoked
    case intentCompleted
    case intentFailed
}

struct VoiceEvent {
    let type: VoiceEventType
    let intentId: String
    let data: [String: Any]?
    let error: Error?
}

// MARK: - Protocols

protocol SpeechRecognizerProtocol {
    func initialize(completion: @escaping (Error?) -> Void)
    func requestMicrophonePermission(completion: @escaping (PermissionStatus) -> Void)
    func requestSpeechPermission(completion: @escaping (PermissionStatus) -> Void)
}

protocol IntentHandlerProtocol {
    func donate(intentId: String, parameters: [String: Any], completion: @escaping (Error?) -> Void)
    @available(iOS 16.0, *)
    func registerAppIntent(_ intentId: String, completion: @escaping (Error?) -> Void)
    func handleIntent(_ intent: INIntent, completion: @escaping (INIntentResponse?) -> Void)
}

// MARK: - Implementations

class SpeechRecognizer: SpeechRecognizerProtocol {
    private var speechRecognizer: SFSpeechRecognizer?
    private var audioEngine: AVAudioEngine?

    func initialize(completion: @escaping (Error?) -> Void) {
        speechRecognizer = SFSpeechRecognizer(locale: Locale.current)
        audioEngine = AVAudioEngine()
        completion(nil)
    }

    func requestMicrophonePermission(completion: @escaping (PermissionStatus) -> Void) {
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            DispatchQueue.main.async {
                completion(granted ? .granted : .denied)
            }
        }
    }

    func requestSpeechPermission(completion: @escaping (PermissionStatus) -> Void) {
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                switch status {
                case .authorized:
                    completion(.granted)
                case .denied, .restricted:
                    completion(.denied)
                case .notDetermined:
                    completion(.undetermined)
                @unknown default:
                    completion(.unavailable)
                }
            }
        }
    }
}

class IntentHandler: IntentHandlerProtocol {
    /// Tell iOS the user just performed this action. Uses
    /// `IntentDonationManager.shared.donate(intent:)` — the App Intents
    /// (iOS 16+) native donate path that wraps the same
    /// `GenericVoiceIntent` Siri already knows about from
    /// `AppShortcutsBridge.generated.swift`. Donating the typed intent
    /// (rather than a loosely-typed `NSUserActivity`) gives Siri's
    /// prediction engine the same shape it sees at invocation time —
    /// better suggestions, and donations become queryable / deletable
    /// via `IntentDonationManager` for future privacy / "forget this"
    /// features.
    ///
    /// `parameters["query"]` is the one string slot today. If absent,
    /// we donate an empty-query variant so iOS still records the user's
    /// usage of the intent id; an empty string is a valid value for the
    /// required `query` parameter at donation time (donation never
    /// triggers `perform()`, so the empty value never reaches JS).
    func donate(intentId: String, parameters: [String: Any], completion: @escaping (Error?) -> Void) {
        if #available(iOS 16.0, *) {
            let query = (parameters["query"] as? String) ?? ""
            let intent = GenericVoiceIntent(intentId: intentId)
            intent.query = query
            Task {
                do {
                    try await IntentDonationManager.shared.donate(intent: intent)
                    completion(nil)
                } catch {
                    completion(error)
                }
            }
            return
        }
        // iOS 15 and earlier — no AppIntents framework. The package
        // already requires iOS 16+ for AppShortcut discovery, so this
        // branch is unreachable for any deployment target we support.
        // Kept for forward-safety only.
        completion(nil)
    }

    @available(iOS 16.0, *)
    func registerAppIntent(_ intentId: String, completion: @escaping (Error?) -> Void) {
        completion(nil)
    }

    func handleIntent(_ intent: INIntent, completion: @escaping (INIntentResponse?) -> Void) {
        if let searchIntent = intent as? INSearchForMessagesIntent {
            let response = INSearchForMessagesIntentResponse(code: .success, userActivity: nil)
            completion(response)
        } else {
            completion(nil)
        }
    }
}

// MARK: - EntityResolver

/// Async request/response bridge for AppEntity queries.
///
/// Generated `<Name>Query: EntityStringQuery` Swift structs call into
/// `resolve(typeName:kind:payload:)` whenever iOS asks the app for
/// entity matches (Siri voice extraction, Spotlight autocomplete,
/// Library tap entity picker). We pick a UUID, store a continuation,
/// emit `onEntityQuery` to JS, and start a timeout Task. JS computes
/// matches and calls back via the `respondToEntityQuery` AsyncFunction,
/// which calls `resolveIfPending` here. Whichever fires first (JS
/// response or timeout) wins; the loser is a no-op because the
/// continuation has been removed from the pending map.
///
/// This is approach A from #28's architecture decision —
/// async-with-timeout. The known limit is that backgrounded scans
/// (where the JS runtime isn't alive) always time out to empty
/// results. Snapshot-store mode (#41) will layer a system-process-
/// readable cache on top to handle that case.
///
/// Note: this class itself is iOS 13+ (`async`/`await` floor). The
/// generated `<Name>Query: EntityStringQuery` callers are
/// `@available(iOS 16.0, *)` because App Intents is iOS 16+, so the
/// resolver only runs from iOS 16+ contexts in practice.
public final class EntityResolver: @unchecked Sendable {
    /// Maximum wall-clock time we wait for the JS resolver before
    /// resuming the iOS query with empty results. iOS itself drops a
    /// scan after about 1-2 seconds in practice, so we time out well
    /// inside that window to keep Spotlight responsive.
    public static let timeoutNanoseconds: UInt64 = 1_000_000_000

    private var pending: [String: CheckedContinuation<[[String: Any]], Never>] = [:]
    private let lock = NSLock()
    private weak var module: ExpoAssistantModule?

    fileprivate init(module: ExpoAssistantModule) {
        self.module = module
    }

    /// Ask the JS resolver registered for `typeName` to produce
    /// entities for the given query `kind` (`"matching"`, `"for"`, or
    /// `"suggested"`) with the `payload` arguments shaped per kind:
    ///   - matching:  ["search": String]
    ///   - for:       ["ids": [String]]
    ///   - suggested: [:]
    /// Returns an array of `[String: Any]` dicts shaped by the JS
    /// resolver; the generated `<Name>Query` calls this and maps each
    /// dict into a fully-typed `<Name>Entity`.
    public func resolve(typeName: String, kind: String, payload: [String: Any]) async -> [[String: Any]] {
        let requestId = UUID().uuidString
        return await withCheckedContinuation { (continuation: CheckedContinuation<[[String: Any]], Never>) in
            lock.lock()
            pending[requestId] = continuation
            lock.unlock()

            module?.sendEvent("onEntityQuery", [
                "requestId": requestId,
                "typeName": typeName,
                "kind": kind,
                "payload": payload,
            ])

            // Race a timeout against the JS callback. Whichever resolves
            // the continuation first wins; the other becomes a no-op
            // when it finds the requestId already gone from `pending`.
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: EntityResolver.timeoutNanoseconds)
                self?.resolveIfPending(requestId: requestId, with: [])
            }
        }
    }

    /// Called from JS via the `respondToEntityQuery` AsyncFunction OR
    /// from the timeout Task. Safe to call repeatedly — only the first
    /// caller for a given `requestId` resumes the continuation; the
    /// rest no-op.
    public func resolveIfPending(requestId: String, with value: [[String: Any]]) {
        lock.lock()
        let cont = pending.removeValue(forKey: requestId)
        lock.unlock()
        cont?.resume(returning: value)
    }
}