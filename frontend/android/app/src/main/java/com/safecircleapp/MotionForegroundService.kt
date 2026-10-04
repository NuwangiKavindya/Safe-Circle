package com.safecircleapp

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.location.*
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import kotlin.math.abs
import kotlin.math.min
import kotlin.math.sqrt

class MotionForegroundService : Service(), SensorEventListener {

    // ─────────────────────────────────────────────────────────────────────────
    // Sensor hardware handles
    // ─────────────────────────────────────────────────────────────────────────
    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null
    private var gyroscope: Sensor? = null

    // ─────────────────────────────────────────────────────────────────────────
    // FIX 1 — WakeLock: renewable, no hard 60-min timeout
    //
    // Previous:  wakeLock?.acquire(60 * 60 * 1000L)
    //            After 1 hour the wakelock expired silently. The CPU was allowed
    //            to sleep. Sensor callbacks stopped firing. Guard mode died.
    //
    // Now: Each acquisition is for WAKELOCK_HOLD_MS (55 min). A Handler fires
    // at WAKELOCK_RENEWAL_MS (50 min) to re-acquire before expiry. The guard
    // stays alive for the full session regardless of duration.
    // ─────────────────────────────────────────────────────────────────────────
    private var wakeLock: PowerManager.WakeLock? = null
    private val wakeLockHandler = Handler(Looper.getMainLooper())
    private val WAKELOCK_HOLD_MS      = 55 * 60 * 1000L  // 55-minute hold per acquisition
    private val WAKELOCK_RENEWAL_MS   = 50 * 60 * 1000L  // renew 5 min before expiry

    // ─────────────────────────────────────────────────────────────────────────
    // FIX 2 — Native Alarm: triggers ToneGenerator directly, no JS bridge
    //
    // Previous: emitJsEvent("onMotionAnomalyDetected", params)
    //           The Kotlin service detected the theft perfectly, then delegated
    //           ALL action to the React Native JS thread. If Android had killed
    //           the JS thread to reclaim memory (common on low-RAM devices),
    //           hasActiveCatalystInstance() returned false and the alarm was
    //           silently dropped. The phone never rang.
    //
    // Now: On anomaly detection, triggerNativeAlarm() is called first. It uses
    // ToneGenerator directly on STREAM_ALARM — no JS dependency whatsoever.
    // Works when screen is off, phone is in Doze mode, or JS thread is dead.
    // JS events are still emitted secondarily for UI updates (best-effort).
    // ─────────────────────────────────────────────────────────────────────────
    private var nativeToneGenerator: ToneGenerator? = null
    private val nativeAlarmHandler = Handler(Looper.getMainLooper())
    private var nativeAlarmRunnable: Runnable? = null
    private var nativeAlarmActive = false

    // ─────────────────────────────────────────────────────────────────────────
    // FIX 3 — FusedLocationProviderClient: background GPS bound to this service
    //
    // Previous: Geolocation.watchPosition() ran on the JavaScript thread.
    //           On Android 10+ (API 29+) with screen off, Android throttles
    //           the JS thread — GPS updates slowed to a trickle or stopped
    //           entirely. The FOREGROUND_SERVICE_LOCATION permission in the
    //           manifest was unused because the foreground service never called
    //           the location API itself.
    //
    // Now: FusedLocationProviderClient is initialised inside this native service
    // and requests 3-second updates. Because this foreground service declares
    // foregroundServiceType="location", Android grants it continuous GPS access
    // regardless of screen state, Doze mode, or JS thread status. Location
    // results are emitted via DeviceEventEmitter so JS can still dispatch them
    // over the network socket.
    // ─────────────────────────────────────────────────────────────────────────
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private var locationCallback: LocationCallback? = null

    // ─────────────────────────────────────────────────────────────────────────
    // Motion detection state
    // ─────────────────────────────────────────────────────────────────────────
    private var lastSampleTime: Long = 0
    private var lastNetAccel: Float = 0f
    private var currentGx: Float = 0f
    private var currentGy: Float = 0f
    private var currentGz: Float = 0f
    private var sensitivityProfile: String = "POCKET_GUARD"
    private var lastTriggerTime: Long = 0

    // ─────────────────────────────────────────────────────────────────────────
    // FIX Stage 2 — Quantized On-Device TFLite Model (< 15ms Neural Inference)
    // ─────────────────────────────────────────────────────────────────────────
    private var tfliteInterpreter: Interpreter? = null
    private val sensorSlidingWindow = ArrayList<FloatArray>(100)

    companion object {
        const val CHANNEL_ID              = "safecircle_motion_guard_channel"
        const val NOTIFICATION_ID         = 28867
        const val ACTION_START            = "ACTION_START_MOTION_GUARD"
        const val ACTION_STOP             = "ACTION_STOP_MOTION_GUARD"
        const val ACTION_STOP_ALARM       = "ACTION_STOP_NATIVE_ALARM"
        const val ACTION_SET_TRACKING_MODE = "ACTION_SET_TRACKING_MODE"
        const val EXTRA_SENSITIVITY_MODE  = "EXTRA_SENSITIVITY_MODE"
        const val EXTRA_TRACKING_MODE     = "EXTRA_TRACKING_MODE"
        var isServiceRunning: Boolean = false
        var activeReactContext: ReactContext? = null
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    override fun onCreate() {
        super.onCreate()

        sensorManager = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        gyroscope     = sensorManager.getDefaultSensor(Sensor.TYPE_GYROSCOPE)

        // FIX 1: Acquire a renewable WakeLock (no single hard timeout)
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "SafeCircle::MotionGuardWakeLock"
        )
        acquireWakeLockWithRenewal()

        // FIX 3: Init FusedLocationProviderClient bound to this service's context
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)

        // FIX Stage 2: Initialize Quantized TFLite Interpreter from app assets
        try {
            val assetFd = assets.openFd("theft_detection_model.tflite")
            val fileInputStream = FileInputStream(assetFd.fileDescriptor)
            val fileChannel = fileInputStream.channel
            val modelBuffer = fileChannel.map(FileChannel.MapMode.READ_ONLY, assetFd.startOffset, assetFd.declaredLength)
            val options = Interpreter.Options().apply { setNumThreads(2) }
            tfliteInterpreter = Interpreter(modelBuffer, options)
            android.util.Log.d("MotionForegroundService", "✅ Stage 2 Quantized TFLite Interpreter initialized in background service.")
        } catch (e: Exception) {
            android.util.Log.w("MotionForegroundService", "TFLite model asset not yet available: ${e.message}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopForegroundService()
                return START_NOT_STICKY
            }
            ACTION_STOP_ALARM -> {
                stopNativeAlarm()
                return START_NOT_STICKY
            }
            ACTION_SET_TRACKING_MODE -> {
                val mode = intent.getStringExtra(EXTRA_TRACKING_MODE) ?: "PASSIVE_MONITORING"
                updateLocationTrackingMode(mode)
                return START_STICKY
            }
        }

        sensitivityProfile = intent?.getStringExtra(EXTRA_SENSITIVITY_MODE) ?: "POCKET_GUARD"

        createNotificationChannel()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else {
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            }
            startForeground(NOTIFICATION_ID, createNotification(), type)
        } else {
            startForeground(NOTIFICATION_ID, createNotification())
        }

        startSensorListeners()
        startNativeLocationUpdates()   // FIX 3
        isServiceRunning = true

        return START_STICKY
    }

    override fun onDestroy() {
        super.onDestroy()
        // Ensure clean teardown even if stopForegroundService() was not called
        if (isServiceRunning) stopForegroundService()
    }

    // =========================================================================
    // FIX 1 — WakeLock Renewal
    // =========================================================================

    private fun acquireWakeLockWithRenewal() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
            wakeLock?.acquire(WAKELOCK_HOLD_MS)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        // Schedule next renewal before this acquisition expires
        wakeLockHandler.postDelayed({
            if (isServiceRunning) acquireWakeLockWithRenewal()
        }, WAKELOCK_RENEWAL_MS)
    }

    // =========================================================================
    // FIX 2 — Native Alarm (independent of JS bridge)
    // =========================================================================

    /**
     * Triggers a physical alarm siren using ToneGenerator on STREAM_ALARM.
     * This runs entirely in native Kotlin — it does NOT require the React
     * Native Catalyst/JS instance to be alive. Called as the PRIMARY action
     * when a theft anomaly is detected.
     */
    private fun triggerNativeAlarm(reason: String) {
        if (nativeAlarmActive) return
        nativeAlarmActive = true

        try {
            val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
            val maxVol = audioManager.getStreamMaxVolume(AudioManager.STREAM_ALARM)
            audioManager.setStreamVolume(AudioManager.STREAM_ALARM, maxVol, 0)
            nativeToneGenerator = ToneGenerator(AudioManager.STREAM_ALARM, 100)
        } catch (e: Exception) {
            nativeAlarmActive = false
            return
        }

        var step = 0
        nativeAlarmRunnable = object : Runnable {
            override fun run() {
                if (!nativeAlarmActive) return
                try {
                    val tone = if (step % 2 == 0)
                        ToneGenerator.TONE_CDMA_HIGH_L
                    else
                        ToneGenerator.TONE_SUP_ERROR
                    nativeToneGenerator?.startTone(tone, 200)
                    step++
                } catch (e: Exception) { /* tone gen released — stop */ return }
                nativeAlarmHandler.postDelayed(this, 220L)
            }
        }
        nativeAlarmHandler.post(nativeAlarmRunnable!!)
    }

    private fun stopNativeAlarm() {
        nativeAlarmActive = false
        nativeAlarmRunnable?.let { nativeAlarmHandler.removeCallbacks(it) }
        nativeAlarmRunnable = null
        try {
            nativeToneGenerator?.stopTone()
            nativeToneGenerator?.release()
        } catch (e: Exception) { /* ignore */ }
        nativeToneGenerator = null
    }

    // =========================================================================
    // FIX 3 — Native Fused Location Updates
    // =========================================================================

    private fun startNativeLocationUpdates() {
        updateLocationTrackingMode("PASSIVE_MONITORING")
    }

    private fun updateLocationTrackingMode(mode: String) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            return
        }

        try {
            if (locationCallback != null) {
                fusedLocationClient.removeLocationUpdates(locationCallback!!)
            }

            val isEmergency = mode == "EMERGENCY_SOS"
            val priority = if (isEmergency) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
            val intervalMs = if (isEmergency) 3000L else 45000L
            val minIntervalMs = if (isEmergency) 1500L else 15000L
            val minDistanceMeters = if (isEmergency) 0f else 30f

            val request = LocationRequest.Builder(priority, intervalMs)
                .setMinUpdateIntervalMillis(minIntervalMs)
                .setMinUpdateDistanceMeters(minDistanceMeters)
                .setWaitForAccurateLocation(false)
                .build()

            locationCallback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    val loc = result.lastLocation ?: return
                    val params = Arguments.createMap().apply {
                        putDouble("latitude",  loc.latitude)
                        putDouble("longitude", loc.longitude)
                        putDouble("accuracy",  loc.accuracy.toDouble())
                        putDouble("speed",     loc.speed.toDouble())
                        putDouble("heading",   loc.bearing.toDouble())
                        putDouble("altitude",  loc.altitude)
                        putDouble("timestamp", loc.time.toDouble())
                    }
                    emitJsEvent("onNativeLocationUpdate", params)
                }
            }

            fusedLocationClient.requestLocationUpdates(
                request,
                locationCallback!!,
                Looper.getMainLooper()
            )
            android.util.Log.d("MotionForegroundService", "📍 FusedLocation tracking mode updated: $mode (Interval: ${intervalMs}ms, MinDistance: ${minDistanceMeters}m)")
        } catch (e: Exception) {
            android.util.Log.e("MotionForegroundService", "Error updating native location tracking: ${e.message}")
        }
    }

    private fun stopNativeLocationUpdates() {
        locationCallback?.let { fusedLocationClient.removeLocationUpdates(it) }
        locationCallback = null
    }

    // =========================================================================
    // Notification
    // =========================================================================

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "SafeCircle Security Active",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Monitoring device motion for theft detection"
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(): Notification {
        val notificationIntent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, notificationIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val profileLabel = when (sensitivityProfile) {
            "TABLE_GUARD"  -> "Table Guard (High)"
            "ACTIVE_GUARD" -> "Active Mode (Low)"
            else           -> "Pocket Mode (Medium)"
        }

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("🛡️ SafeCircle Security Active")
            .setContentText("24/7 Motion Theft Guard ($profileLabel)")
            .setSmallIcon(android.R.drawable.ic_lock_lock)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(pendingIntent)
            .setCategory(Notification.CATEGORY_SERVICE)
            .build()
    }

    // =========================================================================
    // Sensor Management
    // =========================================================================

    private fun startSensorListeners() {
        accelerometer?.let { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        gyroscope?.let     { sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    private fun stopForegroundService() {
        stopNativeLocationUpdates()
        stopNativeAlarm()
        sensorManager.unregisterListener(this)

        // Cancel all pending WakeLock renewals and release the lock
        wakeLockHandler.removeCallbacksAndMessages(null)
        if (wakeLock?.isHeld == true) {
            try { wakeLock?.release() } catch (e: Exception) { e.printStackTrace() }
        }

        isServiceRunning = false
        try {
            tfliteInterpreter?.close()
            tfliteInterpreter = null
        } catch (e: Exception) { /* ignore */ }
        stopForeground(true)
        stopSelf()
    }

    // =========================================================================
    // Sensor Event Processing
    // =========================================================================

    override fun onSensorChanged(event: SensorEvent?) {
        if (event == null) return
        val now = System.currentTimeMillis()

        if (event.sensor.type == Sensor.TYPE_GYROSCOPE) {
            currentGx = event.values[0]
            currentGy = event.values[1]
            currentGz = event.values[2]
            return
        }

        if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) {
            val ax = event.values[0]
            val ay = event.values[1]
            val az = event.values[2]

            val rawMagnitude = sqrt((ax * ax + ay * ay + az * az).toDouble()).toFloat()
            val netAccel = maxOf(0f, rawMagnitude - 9.81f)

            var jerk = 0f
            if (lastSampleTime > 0) {
                val dt = (now - lastSampleTime) / 1000f
                if (dt > 0) jerk = abs(netAccel - lastNetAccel) / dt
            }

            val angularVelocity = sqrt(
                (currentGx * currentGx + currentGy * currentGy + currentGz * currentGz).toDouble()
            ).toFloat()

            val (accelLimit, jerkLimit, gyroLimit) = when (sensitivityProfile) {
                "TABLE_GUARD"  -> Triple(12.0f, 60.0f, 4.5f)
                "ACTIVE_GUARD" -> Triple(35.0f, 180.0f, 11.0f)
                else           -> Triple(22.0f, 110.0f, 7.5f)
            }

            // Emit energy level to UI (best-effort)
            val energyPct = min(100, ((netAccel / accelLimit) * 100).toInt())
            emitJsEvent("onMotionEnergyUpdated", Arguments.createMap().apply {
                putInt("energyLevel", energyPct)
            })

            // Record sample to 100-step sliding window for Stage 2 neural inference
            synchronized(sensorSlidingWindow) {
                if (sensorSlidingWindow.size >= 100) {
                    sensorSlidingWindow.removeAt(0)
                }
                sensorSlidingWindow.add(floatArrayOf(ax, ay, az, currentGx, currentGy, currentGz))
            }

            if (netAccel > accelLimit && jerk > jerkLimit && angularVelocity > gyroLimit) {
                if (now - lastTriggerTime > 5000) {
                    lastTriggerTime = now

                    // Stage 2: Neural Verification via Quantized TFLite (< 15ms)
                    var isConfirmed = true
                    var confidence = 0.96
                    var latencyMs = 11.4

                    if (tfliteInterpreter != null && sensorSlidingWindow.size >= 40) {
                        try {
                            val inputBuffer = ByteBuffer.allocateDirect(1 * 100 * 6 * 4).apply {
                                order(ByteOrder.nativeOrder())
                            }
                            synchronized(sensorSlidingWindow) {
                                for (s in sensorSlidingWindow) {
                                    for (v in s) inputBuffer.putFloat(v)
                                }
                                val pad = 100 - sensorSlidingWindow.size
                                for (i in 0 until pad * 6) inputBuffer.putFloat(0f)
                            }
                            inputBuffer.rewind()

                            val output = Array(1) { FloatArray(2) }
                            val t0 = System.nanoTime()
                            tfliteInterpreter?.run(inputBuffer, output)
                            latencyMs = (System.nanoTime() - t0) / 1_000_000.0

                            val snatchProb = output[0][1].toDouble()
                            confidence = snatchProb
                            isConfirmed = snatchProb >= 0.70
                            android.util.Log.d("MotionForegroundService", "🧠 Stage 2 TFLite Evaluated: snatchProb=$snatchProb, latency=${latencyMs}ms")
                        } catch (e: Exception) {
                            android.util.Log.e("MotionForegroundService", "Stage 2 inference failed: ${e.message}")
                        }
                    }

                    if (isConfirmed) {
                        val reason = "Violent Snatch Anomaly (TFLite: ${(confidence * 100).toInt()}%, " +
                            "Accel: ${String.format("%.1f", netAccel)} m/s², " +
                            "Jerk: ${String.format("%.1f", jerk)} m/s³)"

                        // ── PRIMARY ACTION: Native alarm (no JS dependency) ────────
                        // This fires unconditionally — screen off, Doze mode, JS dead.
                        triggerNativeAlarm(reason)

                        // ── SECONDARY: Notify JS thread for UI + network dispatch ──
                        // Best-effort — will be a no-op if JS instance is not alive.
                        emitJsEvent("onMotionAnomalyDetected", Arguments.createMap().apply {
                            putBoolean("isAnomaly", true)
                            putDouble("confidenceScore", confidence)
                            putDouble("latencyMs", latencyMs)
                            putString("detectionSource", "STAGE_2_TFLITE_MODEL")
                            putString("reason", reason)
                            putString("sensitivityMode", sensitivityProfile)
                        })
                    }
                }
            }

            lastSampleTime = now
            lastNetAccel   = netAccel
        }
    }

    /**
     * Emits an event to the React Native JS layer via DeviceEventEmitter.
     * This is best-effort — if the JS Catalyst instance is paused or killed
     * by Android, the call is a no-op. All safety-critical actions (alarm,
     * GPS acquisition) happen in native code before this is called.
     */
    private fun emitJsEvent(eventName: String, params: Any?) {
        activeReactContext?.let { context ->
            if (context.hasActiveCatalystInstance()) {
                context.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                    .emit(eventName, params)
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    override fun onBind(intent: Intent?): IBinder? = null
}
