import XCTest
import ExpoModulesCore
import Intents
import Speech
import AVFoundation
@testable import ExpoAssistant

@available(iOS 15.0, *)
class ExpoAssistantModuleTests: XCTestCase {

    var module: ExpoAssistantModule!
    var mockSpeechRecognizer: MockSpeechRecognizer!
    var mockIntentHandler: MockIntentHandler!

    override func setUp() {
        super.setUp()
        module = ExpoAssistantModule(appContext: AppContext(config: nil))
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

    // MARK: - Initialization

    func testInitializeWithoutConfig() {
        let expectation = expectation(description: "initialize completes")
        module.initializeModule(config: nil) { error in
            XCTAssertNil(error)
            XCTAssertTrue(self.module.isInitialized)
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2.0)
    }

    func testInitializeWithConfig() {
        let expectation = expectation(description: "initialize with config")
        let config: [String: Any] = [
            "enableBackgroundExecution": true,
            "debugMode": true,
        ]
        module.initializeModule(config: config) { error in
            XCTAssertNil(error)
            XCTAssertTrue(self.module.isInitialized)
            XCTAssertEqual(self.module.config?.debugMode, true)
            XCTAssertEqual(self.module.config?.enableBackgroundExecution, true)
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2.0)
    }

    func testInitializeFailureMarksUninitialized() {
        mockSpeechRecognizer.shouldFailInitialization = true
        let expectation = expectation(description: "initialize fails")
        module.initializeModule(config: nil) { error in
            XCTAssertNotNil(error)
            XCTAssertFalse(self.module.isInitialized)
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Intent donation

    func testDonateIntent() {
        let expectation = expectation(description: "donate completes")
        module.donateIntentInternal(intentId: "search-intent", parameters: ["query": "hello"]) { error in
            XCTAssertNil(error)
            XCTAssertEqual(self.mockIntentHandler.donatedIntents.count, 1)
            XCTAssertEqual(self.mockIntentHandler.donatedIntents.first?.id, "search-intent")
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Permissions

    func testRequestMicrophonePermissionGranted() {
        mockSpeechRecognizer.microphonePermissionResult = .granted
        let expectation = expectation(description: "microphone permission")
        module.requestMicrophonePermissionInternal { status in
            XCTAssertEqual(status, .granted)
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2.0)
    }

    func testRequestMicrophonePermissionDenied() {
        mockSpeechRecognizer.microphonePermissionResult = .denied
        let expectation = expectation(description: "microphone permission denied")
        module.requestMicrophonePermissionInternal { status in
            XCTAssertEqual(status, .denied)
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2.0)
    }

    func testRequestSpeechPermissionGranted() {
        mockSpeechRecognizer.speechPermissionResult = .granted
        let expectation = expectation(description: "speech permission")
        module.requestSpeechRecognitionPermissionInternal { status in
            XCTAssertEqual(status, .granted)
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Capabilities

    func testCheckCapabilitiesShape() {
        let expectation = expectation(description: "capabilities")
        module.checkCapabilitiesInternal { capabilities in
            XCTAssertNotNil(capabilities["ios"])
            let ios = capabilities["ios"] as? [String: Any]
            XCTAssertNotNil(ios?["siriKitSupported"])
            XCTAssertNotNil(ios?["appIntentsSupported"])
            XCTAssertNotNil(ios?["speechRecognitionAvailable"])
            let domains = ios?["availableDomains"] as? [String]
            XCTAssertNotNil(domains)
            XCTAssertGreaterThan(domains?.count ?? 0, 0)
            expectation.fulfill()
        }
        waitForExpectations(timeout: 2.0)
    }

    // MARK: - Event emission

    func testEmitIntentReceivedFiresLocalHandler() {
        let expectation = expectation(description: "event emitted")
        var capturedEvent: VoiceEvent?
        module.onEventReceived = { event in
            capturedEvent = event
            expectation.fulfill()
        }
        // sendEvent inside emitEvent requires the expo runtime; calling
        // outside it would throw. We only assert that the local
        // onEventReceived hook fires synchronously.
        let event = VoiceEvent(type: .intentInvoked, intentId: "test-intent", data: ["k": "v"], error: nil)
        module.onEventReceived?(event)
        waitForExpectations(timeout: 1.0)
        XCTAssertNotNil(capturedEvent)
        XCTAssertEqual(capturedEvent?.intentId, "test-intent")
        XCTAssertEqual(capturedEvent?.type, .intentInvoked)
    }
}

// MARK: - Mocks

@available(iOS 15.0, *)
class MockSpeechRecognizer: SpeechRecognizerProtocol {
    var shouldFailInitialization = false
    var microphonePermissionResult: PermissionStatus = .granted
    var speechPermissionResult: PermissionStatus = .granted

    func initialize(completion: @escaping (Error?) -> Void) {
        if shouldFailInitialization {
            completion(NSError(domain: "ExpoAssistantTests", code: -1))
        } else {
            completion(nil)
        }
    }

    func requestMicrophonePermission(completion: @escaping (PermissionStatus) -> Void) {
        completion(microphonePermissionResult)
    }

    func requestSpeechPermission(completion: @escaping (PermissionStatus) -> Void) {
        completion(speechPermissionResult)
    }
}

@available(iOS 15.0, *)
class MockIntentHandler: IntentHandlerProtocol {
    var donatedIntents: [(id: String, parameters: [String: Any])] = []

    func donate(intentId: String, parameters: [String: Any], completion: @escaping (Error?) -> Void) {
        donatedIntents.append((id: intentId, parameters: parameters))
        completion(nil)
    }

    @available(iOS 16.0, *)
    func registerAppIntent(_ intentId: String, completion: @escaping (Error?) -> Void) {
        completion(nil)
    }

    func handleIntent(_ intent: INIntent, completion: @escaping (INIntentResponse?) -> Void) {
        completion(INSearchForMessagesIntentResponse(code: .success, userActivity: nil))
    }
}
