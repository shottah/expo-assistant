import XCTest
import ExpoModulesCore
import Intents
import Speech
@testable import ExpoAssistant

@available(iOS 13.0, *)
class ExpoAssistantModuleTests: XCTestCase {

    var module: ExpoAssistantModule!
    var mockSpeechRecognizer: MockSpeechRecognizer!
    var mockIntentHandler: MockIntentHandler!

    override func setUp() {
        super.setUp()
        module = ExpoAssistantModule()
        mockSpeechRecognizer = MockSpeechRecognizer()
        mockIntentHandler = MockIntentHandler()

        module.speechRecognizer = mockSpeechRecognizer
        module.intentHandler = mockIntentHandler
    }

    override func tearDown() {
        module = nil
        mockSpeechRecognizer = nil
        mockIntentHandler = nil
        super.tearDown()
    }

    // MARK: - Initialization Tests

    func testModuleInitialization() throws {
        let config = VoiceAssistantConfig(
            enableBackgroundExecution: true,
            debugMode: true
        )

        let expectation = self.expectation(description: "Module initialization")

        module.initialize(config) { error in
            XCTAssertNil(error)
            XCTAssertTrue(self.module.isInitialized)
            XCTAssertEqual(self.module.config?.debugMode, true)
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    func testInitializationFailure() throws {
        mockSpeechRecognizer.shouldFailInitialization = true

        let expectation = self.expectation(description: "Initialization failure")

        module.initialize(nil) { error in
            XCTAssertNotNil(error)
            XCTAssertFalse(self.module.isInitialized)
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Intent Registration Tests

    func testIntentRegistration() throws {
        let intentConfig = IntentConfig(
            id: "test-intent",
            category: "search",
            parameters: [
                VoiceParameter(name: "query", type: .string, required: true)
            ],
            platforms: [
                "ios": [
                    "phrases": ["Search for $(query)"]
                ]
            ]
        )

        let expectation = self.expectation(description: "Intent registration")

        module.registerIntent(intentConfig) { error in
            XCTAssertNil(error)
            XCTAssertTrue(self.module.registeredIntents.contains("test-intent"))
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    func testDuplicateIntentRegistration() throws {
        let intentConfig = IntentConfig(
            id: "duplicate-intent",
            category: "custom",
            parameters: [],
            platforms: [:]
        )

        let expectation1 = self.expectation(description: "First registration")
        let expectation2 = self.expectation(description: "Duplicate registration")

        module.registerIntent(intentConfig) { error in
            XCTAssertNil(error)
            expectation1.fulfill()

            self.module.registerIntent(intentConfig) { error in
                XCTAssertNotNil(error)
                XCTAssertEqual((error as NSError?)?.code, VoiceAssistantError.intentAlreadyRegistered.errorCode)
                expectation2.fulfill()
            }
        }

        waitForExpectations(timeout: 2.0)
    }

    func testIntentUnregistration() throws {
        let intentConfig = IntentConfig(
            id: "removable-intent",
            category: "custom",
            parameters: [],
            platforms: [:]
        )

        let expectation = self.expectation(description: "Intent lifecycle")

        module.registerIntent(intentConfig) { error in
            XCTAssertNil(error)

            self.module.unregisterIntent("removable-intent") { error in
                XCTAssertNil(error)
                XCTAssertFalse(self.module.registeredIntents.contains("removable-intent"))
                expectation.fulfill()
            }
        }

        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Intent Donation Tests

    func testIntentDonation() throws {
        let expectation = self.expectation(description: "Intent donation")

        module.donateIntent(
            intentId: "search-intent",
            parameters: ["query": "test query"]
        ) { error in
            XCTAssertNil(error)
            XCTAssertTrue(self.mockIntentHandler.donatedIntents.contains { $0.id == "search-intent" })
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Permission Tests

    func testMicrophonePermissionRequest() throws {
        mockSpeechRecognizer.mockMicrophonePermission = .notDetermined

        let expectation = self.expectation(description: "Microphone permission")

        module.requestMicrophonePermission { status in
            XCTAssertEqual(status, .granted)
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    func testSpeechRecognitionPermissionRequest() throws {
        mockSpeechRecognizer.mockSpeechPermission = .notDetermined

        let expectation = self.expectation(description: "Speech permission")

        module.requestSpeechRecognitionPermission { status in
            XCTAssertEqual(status, .granted)
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    func testPermissionDenied() throws {
        mockSpeechRecognizer.mockMicrophonePermission = .denied

        let expectation = self.expectation(description: "Permission denied")

        module.requestMicrophonePermission { status in
            XCTAssertEqual(status, .denied)
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Capabilities Tests

    func testCapabilitiesCheck() throws {
        let expectation = self.expectation(description: "Capabilities check")

        module.checkCapabilities { capabilities in
            XCTAssertNotNil(capabilities.ios)

            if #available(iOS 16.0, *) {
                XCTAssertTrue(capabilities.ios!.appIntentsSupported)
            } else {
                XCTAssertTrue(capabilities.ios!.siriKitSupported)
            }

            XCTAssertTrue(capabilities.ios!.speechRecognitionAvailable)
            XCTAssertGreaterThan(capabilities.ios!.availableDomains.count, 0)

            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    // MARK: - SiriKit Integration Tests

    @available(iOS 16.0, *)
    func testAppIntentRegistration() throws {
        let expectation = self.expectation(description: "App Intent registration")

        let intentConfig = IntentConfig(
            id: "app-intent",
            category: "productivity",
            parameters: [],
            platforms: [
                "ios": [
                    "appIntentSchema": "TodoIntent",
                    "phrases": ["Add $(item) to my list"]
                ]
            ]
        )

        module.registerAppIntent(intentConfig) { error in
            XCTAssertNil(error)
            XCTAssertTrue(self.mockIntentHandler.registeredAppIntents.contains("app-intent"))
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    func testSiriKitIntentHandling() throws {
        let expectation = self.expectation(description: "SiriKit intent handling")

        let mockIntent = INSearchForMessagesIntent()
        mockIntent.searchTerm = "test message"

        module.handleSiriIntent(mockIntent) { response in
            XCTAssertNotNil(response)
            XCTAssertEqual(response?.code, .success)
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Background Processing Tests

    func testBackgroundProcessingEnable() throws {
        let expectation = self.expectation(description: "Background processing")

        module.enableBackgroundProcessing { error in
            XCTAssertNil(error)
            XCTAssertTrue(self.module.isBackgroundProcessingEnabled)
            expectation.fulfill()
        }

        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Event Emission Tests

    func testEventEmission() throws {
        let expectation = self.expectation(description: "Event emission")

        var receivedEvent: VoiceEvent?
        module.onEventReceived = { event in
            receivedEvent = event
            expectation.fulfill()
        }

        module.emitEvent(
            type: .intentReceived,
            intentId: "test-intent",
            data: ["test": "data"]
        )

        waitForExpectations(timeout: 1.0)

        XCTAssertNotNil(receivedEvent)
        XCTAssertEqual(receivedEvent?.type, .intentReceived)
        XCTAssertEqual(receivedEvent?.intentId, "test-intent")
    }

    // MARK: - Debug Mode Tests

    func testDebugMode() throws {
        XCTAssertFalse(module.debugMode)

        module.setDebugMode(true) { error in
            XCTAssertNil(error)
            XCTAssertTrue(self.module.debugMode)
        }

        module.setDebugMode(false) { error in
            XCTAssertNil(error)
            XCTAssertFalse(self.module.debugMode)
        }
    }
}

// MARK: - Mock Classes

class MockSpeechRecognizer: SpeechRecognizerProtocol {
    var shouldFailInitialization = false
    var mockMicrophonePermission: AVAudioSession.RecordPermission = .granted
    var mockSpeechPermission: SFSpeechRecognizerAuthorizationStatus = .authorized

    func initialize(completion: @escaping (Error?) -> Void) {
        if shouldFailInitialization {
            completion(NSError(domain: "Test", code: -1))
        } else {
            completion(nil)
        }
    }

    func requestMicrophonePermission(completion: @escaping (PermissionStatus) -> Void) {
        switch mockMicrophonePermission {
        case .granted:
            completion(.granted)
        case .denied:
            completion(.denied)
        default:
            completion(.undetermined)
        }
    }

    func requestSpeechPermission(completion: @escaping (PermissionStatus) -> Void) {
        switch mockSpeechPermission {
        case .authorized:
            completion(.granted)
        case .denied:
            completion(.denied)
        default:
            completion(.undetermined)
        }
    }
}

class MockIntentHandler: IntentHandlerProtocol {
    var donatedIntents: [(id: String, parameters: [String: Any])] = []
    var registeredAppIntents: [String] = []

    func donate(intentId: String, parameters: [String: Any], completion: @escaping (Error?) -> Void) {
        donatedIntents.append((id: intentId, parameters: parameters))
        completion(nil)
    }

    func registerAppIntent(_ intentId: String, completion: @escaping (Error?) -> Void) {
        registeredAppIntents.append(intentId)
        completion(nil)
    }

    func handleIntent(_ intent: INIntent, completion: @escaping (INIntentResponse?) -> Void) {
        let response = INSearchForMessagesIntentResponse(code: .success, userActivity: nil)
        completion(response)
    }
}

// MARK: - Test Helpers

enum VoiceAssistantError: Error {
    case intentAlreadyRegistered
    case intentNotFound
    case permissionDenied

    var errorCode: Int {
        switch self {
        case .intentAlreadyRegistered: return 1001
        case .intentNotFound: return 1002
        case .permissionDenied: return 1003
        }
    }
}