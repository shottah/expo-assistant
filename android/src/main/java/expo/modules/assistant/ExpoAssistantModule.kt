package expo.modules.assistant

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.os.Build
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.*

class ExpoAssistantModule : Module() {
    internal var context: Context? = null
    internal var shortcutManager: ShortcutManager? = null
    internal var speechRecognizer: SpeechRecognizerWrapper? = null
    internal var intentHandler: IntentHandler? = null

    internal var isInitialized = false
    internal var debugMode = false
    internal var appActionsEnabled = false
    internal var backgroundProcessingEnabled = false
    internal var config: VoiceAssistantConfig? = null
    internal val registeredIntents = mutableSetOf<String>()

    private val eventListeners = mutableMapOf<String, MutableList<(Map<String, Any>) -> Unit>>()

    override fun definition() = ModuleDefinition {
        Name("ExpoAssistant")

        Events("onIntentReceived", "onIntentCompleted", "onIntentFailed")

        AsyncFunction("initialize") { config: Map<String, Any>?, promise: Promise ->
            initialize(config, promise)
        }

        AsyncFunction("registerIntent") { config: Map<String, Any>, promise: Promise ->
            registerIntent(config, promise)
        }

        AsyncFunction("unregisterIntent") { intentId: String, promise: Promise ->
            unregisterIntent(intentId, promise)
        }

        AsyncFunction("donateIntent") { intentId: String, parameters: Map<String, Any>, promise: Promise ->
            donateIntent(intentId, parameters, promise)
        }

        AsyncFunction("requestMicrophonePermission") { promise: Promise ->
            requestMicrophonePermission(promise)
        }

        AsyncFunction("requestSpeechRecognitionPermission") { promise: Promise ->
            requestSpeechRecognitionPermission(promise)
        }

        AsyncFunction("checkCapabilities") { promise: Promise ->
            checkCapabilities(promise)
        }

        AsyncFunction("enableAppActions") { promise: Promise ->
            enableAppActions(promise)
        }

        AsyncFunction("enableBackgroundProcessing") { promise: Promise ->
            enableBackgroundProcessing(promise)
        }

        AsyncFunction("enableCustomUI") { promise: Promise ->
            enableCustomUI(promise)
        }

        AsyncFunction("enableSiriKit") { promise: Promise ->
            // iOS only - resolve immediately on Android
            promise.resolve(Unit)
        }

        AsyncFunction("getPlatform") { promise: Promise ->
            getPlatform(promise)
        }

        AsyncFunction("getLocale") { promise: Promise ->
            getLocale(promise)
        }

        AsyncFunction("setDebugMode") { enabled: Boolean, promise: Promise ->
            setDebugMode(enabled, promise)
        }

        Function("handleAppAction") { intent: Intent ->
            handleAppAction(intent)
        }

        OnCreate {
            context = appContext.reactContext ?: appContext.currentActivity
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
                shortcutManager = context?.getSystemService(Context.SHORTCUT_SERVICE) as? ShortcutManager
            }
            speechRecognizer = SpeechRecognizerWrapper(context!!)
            intentHandler = IntentHandler(context!!)
        }
    }

    internal fun initialize(config: Map<String, Any>?, promise: Promise) {
        try {
            config?.let {
                this.config = VoiceAssistantConfig.fromMap(it)
                debugMode = this.config?.debugMode ?: false
            }

            speechRecognizer?.initialize()
            isInitialized = true
            promise.resolve(Unit)
        } catch (e: Exception) {
            isInitialized = false
            promise.reject(CodedException("INIT_FAILED", e.message, e))
        }
    }

    internal fun registerIntent(config: Map<String, Any>, promise: Promise) {
        if (!isInitialized) {
            promise.reject("MODULE_NOT_INITIALIZED", "Module not initialized", null)
            return
        }

        val intentId = config["id"] as? String
        if (intentId == null) {
            promise.reject("INVALID_CONFIG", "Intent ID is required", null)
            return
        }

        if (registeredIntents.contains(intentId)) {
            promise.reject(CodedException("ALREADY_REGISTERED", "Intent $intentId is already registered", null))
            return
        }

        try {
            createDynamicShortcut(config)
            registeredIntents.add(intentId)
            promise.resolve(Unit)
        } catch (e: Exception) {
            promise.reject(CodedException("REGISTRATION_FAILED", e.message, e))
        }
    }

    internal fun unregisterIntent(intentId: String, promise: Promise) {
        if (!registeredIntents.contains(intentId)) {
            promise.reject("INTENT_NOT_FOUND", "Intent $intentId not found", null)
            return
        }

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
                shortcutManager?.removeDynamicShortcuts(listOf(intentId))
            }
            registeredIntents.remove(intentId)
            promise.resolve(Unit)
        } catch (e: Exception) {
            promise.reject(CodedException("UNREGISTER_FAILED", e.message, e))
        }
    }

    internal fun donateIntent(intentId: String, parameters: Map<String, Any>, promise: Promise) {
        try {
            intentHandler?.donateIntent(intentId, parameters)
            promise.resolve(Unit)
        } catch (e: Exception) {
            promise.reject(CodedException("DONATION_FAILED", e.message, e))
        }
    }

    internal fun requestMicrophonePermission(promise: Promise) {
        val permission = ContextCompat.checkSelfPermission(
            context!!,
            Manifest.permission.RECORD_AUDIO
        )

        val status = when (permission) {
            PackageManager.PERMISSION_GRANTED -> "granted"
            else -> "denied"
        }

        promise.resolve(status)
    }

    internal fun requestSpeechRecognitionPermission(promise: Promise) {
        val isAvailable = speechRecognizer?.isRecognitionAvailable() ?: false
        promise.resolve(if (isAvailable) "granted" else "unavailable")
    }

    internal fun checkCapabilities(promise: Promise) {
        val capabilities = mapOf(
            "android" to mapOf(
                "appActionsSupported" to true,
                "googleAssistantAvailable" to isGoogleAssistantAvailable(),
                "voiceAccessSupported" to true,
                "slicesSupported" to (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)
            )
        )
        promise.resolve(capabilities)
    }

    internal fun enableAppActions(promise: Promise) {
        appActionsEnabled = true
        promise.resolve(Unit)
    }

    internal fun enableBackgroundProcessing(promise: Promise) {
        backgroundProcessingEnabled = true
        promise.resolve(Unit)
    }

    internal fun enableCustomUI(promise: Promise) {
        promise.resolve(Unit)
    }

    internal fun getPlatform(promise: Promise) {
        promise.resolve("android")
    }

    internal fun getLocale(promise: Promise) {
        val locale = Locale.getDefault()
        promise.resolve(locale.toString())
    }

    internal fun setDebugMode(enabled: Boolean, promise: Promise) {
        debugMode = enabled
        promise.resolve(Unit)
    }

    internal fun handleAppAction(intent: Intent): Map<String, Any> {
        val result = mutableMapOf<String, Any>()

        when (intent.action) {
            "actions.intent.START_EXERCISE" -> {
                result["action"] = "START_EXERCISE"
                intent.getStringExtra("exercise.name")?.let {
                    result["exerciseType"] = it
                }
            }
            "actions.intent.GET_THING" -> {
                result["action"] = "GET_THING"
                intent.getStringExtra("thing.name")?.let {
                    result["query"] = it
                }
            }
            // Legacy Google Now slot intent constant from the (now-deprecated
            // and unhosted) com.google.android.gms:play-services-actions
            // artifact. Inlined to avoid the dep.
            "com.google.android.gms.actions.CREATE_NOTE" -> {
                result["action"] = "CREATE_NOTE"
                intent.getStringExtra(Intent.EXTRA_TEXT)?.let {
                    result["text"] = it
                }
            }
            else -> {
                result["action"] = intent.action ?: "UNKNOWN"
                intent.extras?.let { extras ->
                    for (key in extras.keySet()) {
                        extras.get(key)?.let { result[key] = it.toString() }
                    }
                }
            }
        }

        return result
    }

    internal fun createDynamicShortcut(config: Map<String, Any>) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return

        val intentId = config["id"] as String
        val category = config["category"] as? String ?: "custom"
        val platforms = config["platforms"] as? Map<String, Any>
        val androidConfig = platforms?.get("android") as? Map<String, Any>
        val capability = androidConfig?.get("capability") as? String ?: "custom.action"

        val shortcutIntent = Intent(context, context!!.javaClass).apply {
            action = capability
            putExtra("intentId", intentId)
        }

        val shortcut = ShortcutInfo.Builder(context, intentId)
            .setShortLabel(intentId)
            .setLongLabel("Voice command: $intentId")
            .setIntent(shortcutIntent)
            .build()

        shortcutManager?.addDynamicShortcuts(listOf(shortcut))
    }

    internal fun addListener(event: String, listener: (Map<String, Any>) -> Unit) {
        eventListeners.getOrPut(event) { mutableListOf() }.add(listener)
    }

    internal fun emitEvent(event: String, data: Map<String, Any>) {
        eventListeners[event]?.forEach { it(data) }
        // sendEvent depends on the expo appContext being attached. In unit
        // tests (where the module is instantiated outside the expo runtime)
        // this throws IllegalArgumentException. Internal listeners still fire.
        try {
            sendEvent(event, data)
        } catch (_: IllegalArgumentException) {
        }
    }

    private fun isGoogleAssistantAvailable(): Boolean {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        val activities = context?.packageManager?.queryIntentActivities(intent, 0)
        return activities?.isNotEmpty() ?: false
    }
}

// Supporting classes

data class VoiceAssistantConfig(
    val enableBackgroundExecution: Boolean = false,
    val debugMode: Boolean = false,
    val enableCustomUI: Boolean = false,
    val enableMediaSession: Boolean = false
) {
    companion object {
        fun fromMap(map: Map<String, Any>): VoiceAssistantConfig {
            return VoiceAssistantConfig(
                enableBackgroundExecution = map["enableBackgroundExecution"] as? Boolean ?: false,
                debugMode = map["debugMode"] as? Boolean ?: false,
                enableCustomUI = map["enableCustomUI"] as? Boolean ?: false,
                enableMediaSession = map["enableMediaSession"] as? Boolean ?: false
            )
        }
    }
}

class SpeechRecognizerWrapper(private val context: Context) {
    private var speechRecognizer: SpeechRecognizer? = null

    fun initialize() {
        speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context)
    }

    fun isRecognitionAvailable(): Boolean {
        return SpeechRecognizer.isRecognitionAvailable(context)
    }

    fun destroy() {
        speechRecognizer?.destroy()
    }
}

class IntentHandler(private val context: Context) {
    fun donateIntent(intentId: String, parameters: Map<String, Any>) {
        // Create an intent that can be handled by the app
        val intent = Intent("com.expoassistant.ACTION_DONATE").apply {
            putExtra("intentId", intentId)
            parameters.forEach { (key, value) ->
                when (value) {
                    is String -> putExtra(key, value)
                    is Int -> putExtra(key, value)
                    is Boolean -> putExtra(key, value)
                    is Float -> putExtra(key, value)
                    is Double -> putExtra(key, value)
                }
            }
        }

        // Send broadcast for the intent donation
        context.sendBroadcast(intent)
    }

    fun handleIntent(intent: Intent): Map<String, Any> {
        val result = mutableMapOf<String, Any>()
        result["action"] = intent.action ?: "unknown"

        intent.extras?.let { extras ->
            for (key in extras.keySet()) {
                extras.get(key)?.let { result[key] = it }
            }
        }

        return result
    }
}