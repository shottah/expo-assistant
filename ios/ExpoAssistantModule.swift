import ExpoModulesCore
import Intents
import Speech
import AVFoundation

@available(iOS 13.0, *)
public class ExpoAssistantModule: Module {
    private var speechRecognizer: SpeechRecognizerProtocol = SpeechRecognizer()
    private var intentHandler: IntentHandlerProtocol = IntentHandler()
    private var registeredIntents: Set<String> = []
    private var config: VoiceAssistantConfig?
    private var isInitialized = false
    private var isBackgroundProcessingEnabled = false
    private var debugMode = false

    var onEventReceived: ((VoiceEvent) -> Void)?

    public func definition() -> ModuleDefinition {
        Name("ExpoAssistant")

        Events("onIntentReceived", "onIntentCompleted", "onIntentFailed")

        AsyncFunction("initialize") { (config: [String: Any]?) -> Promise<Void> in
            return Promise { resolver, rejecter in
                self.initializeModule(config: config) { error in
                    if let error = error {
                        rejecter(error.localizedDescription, error.localizedDescription, error)
                    } else {
                        resolver(())
                    }
                }
            }
        }

        AsyncFunction("registerIntent") { (config: [String: Any]) -> Promise<Void> in
            return Promise { resolver, rejecter in
                guard let intentId = config["id"] as? String else {
                    rejecter("INVALID_CONFIG", "Intent ID is required", nil)
                    return
                }

                if self.registeredIntents.contains(intentId) {
                    rejecter("ALREADY_REGISTERED", "Intent \(intentId) is already registered", nil)
                    return
                }

                self.registerIntentInternal(config: config) { error in
                    if let error = error {
                        rejecter(error.localizedDescription, error.localizedDescription, error)
                    } else {
                        self.registeredIntents.insert(intentId)
                        resolver(())
                    }
                }
            }
        }

        AsyncFunction("unregisterIntent") { (intentId: String) -> Promise<Void> in
            return Promise { resolver, rejecter in
                if !self.registeredIntents.contains(intentId) {
                    rejecter("NOT_FOUND", "Intent \(intentId) not found", nil)
                    return
                }

                self.registeredIntents.remove(intentId)
                resolver(())
            }
        }

        AsyncFunction("donateIntent") { (intentId: String, parameters: [String: Any]) -> Promise<Void> in
            return Promise { resolver, rejecter in
                self.donateIntentInternal(intentId: intentId, parameters: parameters) { error in
                    if let error = error {
                        rejecter(error.localizedDescription, error.localizedDescription, error)
                    } else {
                        resolver(())
                    }
                }
            }
        }

        AsyncFunction("requestMicrophonePermission") -> Promise<String> in
            return Promise { resolver, rejecter in
                self.requestMicrophonePermissionInternal { status in
                    resolver(status.rawValue)
                }
            }
        }

        AsyncFunction("requestSpeechRecognitionPermission") -> Promise<String> in
            return Promise { resolver, rejecter in
                self.requestSpeechRecognitionPermissionInternal { status in
                    resolver(status.rawValue)
                }
            }
        }

        AsyncFunction("checkCapabilities") -> Promise<[String: Any]> in
            return Promise { resolver, rejecter in
                self.checkCapabilitiesInternal { capabilities in
                    resolver(capabilities)
                }
            }
        }

        AsyncFunction("enableSiriKit") -> Promise<Void> in
            return Promise { resolver, rejecter in
                self.enableSiriKitInternal { error in
                    if let error = error {
                        rejecter(error.localizedDescription, error.localizedDescription, error)
                    } else {
                        resolver(())
                    }
                }
            }
        }

        AsyncFunction("enableBackgroundProcessing") -> Promise<Void> in
            return Promise { resolver, rejecter in
                self.isBackgroundProcessingEnabled = true
                resolver(())
            }
        }

        AsyncFunction("enableCustomUI") -> Promise<Void> in
            return Promise { resolver, rejecter in
                resolver(())
            }
        }

        AsyncFunction("getPlatform") -> Promise<String> in
            return Promise { resolver, rejecter in
                resolver("ios")
            }
        }

        AsyncFunction("getLocale") -> Promise<String> in
            return Promise { resolver, rejecter in
                let locale = Locale.current.identifier
                resolver(locale)
            }
        }

        AsyncFunction("setDebugMode") { (enabled: Bool) -> Promise<Void> in
            return Promise { resolver, rejecter in
                self.debugMode = enabled
                resolver(())
            }
        }

        AsyncFunction("enableAppActions") -> Promise<Void> in
            return Promise { resolver, rejecter in
                resolver(())
            }
        }
    }

    // MARK: - Internal Methods

    private func initializeModule(config: [String: Any]?, completion: @escaping (Error?) -> Void) {
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

    private func donateIntentInternal(intentId: String, parameters: [String: Any], completion: @escaping (Error?) -> Void) {
        intentHandler.donate(intentId: intentId, parameters: parameters, completion: completion)
    }

    private func requestMicrophonePermissionInternal(completion: @escaping (PermissionStatus) -> Void) {
        speechRecognizer.requestMicrophonePermission(completion: completion)
    }

    private func requestSpeechRecognitionPermissionInternal(completion: @escaping (PermissionStatus) -> Void) {
        speechRecognizer.requestSpeechPermission(completion: completion)
    }

    private func checkCapabilitiesInternal(completion: @escaping ([String: Any]) -> Void) {
        var capabilities: [String: Any] = [:]

        var iosCapabilities: [String: Any] = [
            "speechRecognitionAvailable": SFSpeechRecognizer.isAvailable(),
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
        case .intentReceived:
            sendEvent("onIntentReceived", ["intentId": intentId, "data": data ?? [:]])
        case .intentCompleted:
            sendEvent("onIntentCompleted", ["intentId": intentId, "data": data ?? [:]])
        case .intentFailed:
            sendEvent("onIntentFailed", ["intentId": intentId, "error": error?.localizedDescription ?? "Unknown error"])
        }
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
    case intentReceived
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
    func donate(intentId: String, parameters: [String: Any], completion: @escaping (Error?) -> Void) {
        let activity = NSUserActivity(activityType: "com.expoassistant.\(intentId)")
        activity.title = intentId
        activity.userInfo = parameters
        activity.isEligibleForPrediction = true
        activity.persistentIdentifier = NSUserActivityPersistentIdentifier(intentId)

        activity.becomeCurrent()
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