package expo.modules.assistant

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ShortcutManager
import android.os.Build
import com.google.android.gms.actions.NoteIntents
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import io.mockk.*
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [Build.VERSION_CODES.O], manifest = Config.NONE)
class ExpoAssistantModuleTest {

    private lateinit var module: ExpoAssistantModule
    private lateinit var context: Context
    private lateinit var mockShortcutManager: ShortcutManager
    private lateinit var mockSpeechRecognizer: SpeechRecognizerWrapper
    private lateinit var mockIntentHandler: IntentHandler

    @Before
    fun setUp() {
        context = RuntimeEnvironment.getApplication()
        module = ExpoAssistantModule()

        mockShortcutManager = mockk(relaxed = true)
        mockSpeechRecognizer = mockk(relaxed = true)
        mockIntentHandler = mockk(relaxed = true)

        module.context = context
        module.shortcutManager = mockShortcutManager
        module.speechRecognizer = mockSpeechRecognizer
        module.intentHandler = mockIntentHandler
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    // MARK: - Initialization Tests

    @Test
    fun `test module initialization with config`() {
        val config = mapOf(
            "enableBackgroundExecution" to true,
            "debugMode" to true
        )

        val promise = mockk<Promise>(relaxed = true)

        module.initialize(config, promise)

        verify { promise.resolve(Unit) }
        assertTrue(module.isInitialized)
        assertEquals(true, module.config?.debugMode)
    }

    @Test
    fun `test module initialization without config`() {
        val promise = mockk<Promise>(relaxed = true)

        module.initialize(null, promise)

        verify { promise.resolve(Unit) }
        assertTrue(module.isInitialized)
    }

    @Test
    fun `test module initialization failure`() {
        val promise = mockk<Promise>(relaxed = true)
        every { mockSpeechRecognizer.initialize() } throws Exception("Init failed")

        module.initialize(null, promise)

        verify { promise.reject(any<CodedException>()) }
        assertFalse(module.isInitialized)
    }

    // MARK: - Intent Registration Tests

    @Test
    fun `test intent registration`() {
        val intentConfig = mapOf(
            "id" to "test-intent",
            "category" to "search",
            "parameters" to listOf(
                mapOf("name" to "query", "type" to "string", "required" to true)
            ),
            "platforms" to mapOf(
                "android" to mapOf(
                    "capability" to "actions.intent.GET_THING",
                    "parameters" to listOf(
                        mapOf("name" to "query", "key" to "thing.name")
                    )
                )
            )
        )

        val promise = mockk<Promise>(relaxed = true)
        module.isInitialized = true

        module.registerIntent(intentConfig, promise)

        verify { mockShortcutManager.addDynamicShortcuts(any()) }
        verify { promise.resolve(Unit) }
        assertTrue(module.registeredIntents.contains("test-intent"))
    }

    @Test
    fun `test duplicate intent registration`() {
        val intentConfig = mapOf(
            "id" to "duplicate-intent",
            "category" to "custom"
        )

        val promise1 = mockk<Promise>(relaxed = true)
        val promise2 = mockk<Promise>(relaxed = true)
        module.isInitialized = true

        module.registerIntent(intentConfig, promise1)
        module.registerIntent(intentConfig, promise2)

        verify { promise1.resolve(Unit) }
        verify { promise2.reject(any<CodedException>()) }
    }

    @Test
    fun `test intent registration when not initialized`() {
        val intentConfig = mapOf("id" to "test-intent")
        val promise = mockk<Promise>(relaxed = true)
        module.isInitialized = false

        module.registerIntent(intentConfig, promise)

        verify { promise.reject("MODULE_NOT_INITIALIZED", "Module not initialized", null) }
    }

    @Test
    fun `test intent unregistration`() {
        val promise = mockk<Promise>(relaxed = true)
        module.registeredIntents.add("removable-intent")

        module.unregisterIntent("removable-intent", promise)

        verify { mockShortcutManager.removeDynamicShortcuts(listOf("removable-intent")) }
        verify { promise.resolve(Unit) }
        assertFalse(module.registeredIntents.contains("removable-intent"))
    }

    @Test
    fun `test unregistering non-existent intent`() {
        val promise = mockk<Promise>(relaxed = true)

        module.unregisterIntent("non-existent", promise)

        verify { promise.reject("INTENT_NOT_FOUND", "Intent non-existent not found", null) }
    }

    // MARK: - Intent Donation Tests

    @Test
    fun `test intent donation`() {
        val promise = mockk<Promise>(relaxed = true)
        val parameters = mapOf("query" to "test query")

        module.donateIntent("search-intent", parameters, promise)

        verify { mockIntentHandler.donateIntent("search-intent", parameters) }
        verify { promise.resolve(Unit) }
    }

    // MARK: - App Action Handling Tests

    @Test
    fun `test handling exercise app action`() {
        val intent = mockk<Intent> {
            every { action } returns "actions.intent.START_EXERCISE"
            every { getStringExtra("exercise.name") } returns "running"
        }

        val result = module.handleAppAction(intent)

        assertNotNull(result)
        assertEquals("START_EXERCISE", result["action"])
        assertEquals("running", result["exerciseType"])
    }

    @Test
    fun `test handling search app action`() {
        val intent = mockk<Intent> {
            every { action } returns "actions.intent.GET_THING"
            every { getStringExtra("thing.name") } returns "laptop"
        }

        val result = module.handleAppAction(intent)

        assertNotNull(result)
        assertEquals("GET_THING", result["action"])
        assertEquals("laptop", result["query"])
    }

    @Test
    fun `test handling note app action`() {
        val intent = mockk<Intent> {
            every { action } returns NoteIntents.ACTION_CREATE_NOTE
            every { getStringExtra(Intent.EXTRA_TEXT) } returns "Buy milk"
        }

        val result = module.handleAppAction(intent)

        assertNotNull(result)
        assertEquals("CREATE_NOTE", result["action"])
        assertEquals("Buy milk", result["text"])
    }

    @Test
    fun `test handling custom intent`() {
        val intent = mockk<Intent> {
            every { action } returns "com.app.CUSTOM_ACTION"
            every { extras } returns mockk(relaxed = true)
        }

        val result = module.handleAppAction(intent)

        assertNotNull(result)
        assertEquals("com.app.CUSTOM_ACTION", result["action"])
    }

    // MARK: - Permission Tests

    @Test
    fun `test microphone permission request granted`() {
        val promise = mockk<Promise>(relaxed = true)
        every {
            context.checkPermission(
                android.Manifest.permission.RECORD_AUDIO,
                any(),
                any()
            )
        } returns PackageManager.PERMISSION_GRANTED

        module.requestMicrophonePermission(promise)

        verify { promise.resolve("granted") }
    }

    @Test
    fun `test microphone permission request denied`() {
        val promise = mockk<Promise>(relaxed = true)
        every {
            context.checkPermission(
                android.Manifest.permission.RECORD_AUDIO,
                any(),
                any()
            )
        } returns PackageManager.PERMISSION_DENIED

        module.requestMicrophonePermission(promise)

        verify { promise.resolve("denied") }
    }

    @Test
    fun `test speech recognition permission request`() {
        val promise = mockk<Promise>(relaxed = true)
        every { mockSpeechRecognizer.isRecognitionAvailable() } returns true

        module.requestSpeechRecognitionPermission(promise)

        verify { promise.resolve("granted") }
    }

    // MARK: - Capabilities Tests

    @Test
    fun `test capabilities check`() {
        val promise = mockk<Promise>(relaxed = true)
        every { mockSpeechRecognizer.isRecognitionAvailable() } returns true

        module.checkCapabilities(promise)

        val captor = slot<Map<String, Any>>()
        verify { promise.resolve(capture(captor)) }

        val capabilities = captor.captured
        assertNotNull(capabilities["android"])

        val androidCaps = capabilities["android"] as Map<String, Any>
        assertTrue(androidCaps["appActionsSupported"] as Boolean)
        assertTrue(androidCaps["googleAssistantAvailable"] as Boolean)
    }

    // MARK: - Platform Features Tests

    @Test
    fun `test enable app actions`() {
        val promise = mockk<Promise>(relaxed = true)

        module.enableAppActions(promise)

        verify { promise.resolve(Unit) }
        assertTrue(module.appActionsEnabled)
    }

    @Test
    fun `test enable background processing`() {
        val promise = mockk<Promise>(relaxed = true)

        module.enableBackgroundProcessing(promise)

        verify { promise.resolve(Unit) }
        assertTrue(module.backgroundProcessingEnabled)
    }

    @Test
    fun `test enable custom UI`() {
        val promise = mockk<Promise>(relaxed = true)

        module.enableCustomUI(promise)

        verify { promise.resolve(Unit) }
    }

    @Test
    fun `test get platform`() {
        val promise = mockk<Promise>(relaxed = true)

        module.getPlatform(promise)

        verify { promise.resolve("android") }
    }

    @Test
    fun `test get locale`() {
        val promise = mockk<Promise>(relaxed = true)

        module.getLocale(promise)

        verify { promise.resolve(any<String>()) }
    }

    @Test
    fun `test set debug mode`() {
        val promise = mockk<Promise>(relaxed = true)

        module.setDebugMode(true, promise)

        verify { promise.resolve(Unit) }
        assertTrue(module.debugMode)

        module.setDebugMode(false, promise)

        assertFalse(module.debugMode)
    }

    // MARK: - Event Emission Tests

    @Test
    fun `test event emission for intent received`() {
        val listener = mockk<(Map<String, Any>) -> Unit>(relaxed = true)
        module.addListener("onIntentReceived", listener)

        module.emitEvent("onIntentReceived", mapOf(
            "intentId" to "test-intent",
            "data" to mapOf("test" to "data")
        ))

        verify { listener(any()) }
    }

    @Test
    fun `test event emission for intent completed`() {
        val listener = mockk<(Map<String, Any>) -> Unit>(relaxed = true)
        module.addListener("onIntentCompleted", listener)

        module.emitEvent("onIntentCompleted", mapOf(
            "intentId" to "test-intent",
            "data" to mapOf("result" to "success")
        ))

        verify { listener(any()) }
    }

    @Test
    fun `test event emission for intent failed`() {
        val listener = mockk<(Map<String, Any>) -> Unit>(relaxed = true)
        module.addListener("onIntentFailed", listener)

        module.emitEvent("onIntentFailed", mapOf(
            "intentId" to "test-intent",
            "error" to "Test error"
        ))

        verify { listener(any()) }
    }

    // MARK: - Shortcut Creation Tests

    @Test
    @Config(sdk = [Build.VERSION_CODES.N_MR1])
    fun `test dynamic shortcut creation`() {
        val intentConfig = mapOf(
            "id" to "shortcut-intent",
            "category" to "productivity",
            "platforms" to mapOf(
                "android" to mapOf(
                    "capability" to "actions.intent.CREATE_NOTE"
                )
            )
        )

        module.createDynamicShortcut(intentConfig)

        verify { mockShortcutManager.addDynamicShortcuts(any()) }
    }

    // MARK: - Integration Tests

    @Test
    fun `test complete voice command flow`() {
        // Initialize
        val initPromise = mockk<Promise>(relaxed = true)
        module.initialize(mapOf("debugMode" to true), initPromise)
        verify { initPromise.resolve(Unit) }

        // Register intent
        val registerPromise = mockk<Promise>(relaxed = true)
        val intentConfig = mapOf(
            "id" to "search-intent",
            "category" to "search",
            "parameters" to listOf(
                mapOf("name" to "query", "type" to "string", "required" to true)
            )
        )
        module.registerIntent(intentConfig, registerPromise)
        verify { registerPromise.resolve(Unit) }

        // Handle app action
        val intent = mockk<Intent> {
            every { action } returns "actions.intent.GET_THING"
            every { getStringExtra("thing.name") } returns "test query"
        }

        val result = module.handleAppAction(intent)
        assertNotNull(result)
        assertEquals("test query", result["query"])

        // Emit event
        val listener = mockk<(Map<String, Any>) -> Unit>(relaxed = true)
        module.addListener("onIntentReceived", listener)

        module.emitEvent("onIntentReceived", mapOf(
            "intentId" to "search-intent",
            "data" to result
        ))

        verify { listener(any()) }
    }
}