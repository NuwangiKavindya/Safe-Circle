package com.safecircleapp

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

/**
 * SafeCircleMessagingService — Native Firebase Cloud Messaging Service
 *
 * Solves Issue 3.1: Remote Siren Ignored When Android App Is Backgrounded.
 *
 * When the React Native app is backgrounded or killed, the WebSocket connection
 * is dropped and the JavaScript thread is frozen. High-priority FCM data messages
 * wake up this native service via Android OS even during deep Doze mode.
 *
 * Supported Actions:
 *  - START: Sounds the native siren ToneGenerator at 100% volume on STREAM_ALARM,
 *           vibrates the phone, and ensures MotionForegroundService is running.
 *  - STOP:  Silences the native siren immediately and cancels vibration.
 */
class SafeCircleMessagingService : FirebaseMessagingService() {

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "📱 New FCM Registration Token received: $token")
    }

    override fun onMessageReceived(remoteMessage: RemoteMessage) {
        super.onMessageReceived(remoteMessage)
        Log.d(TAG, "🚨 FCM High-Priority message received from: ${remoteMessage.from}")

        val data = remoteMessage.data
        if (data.isEmpty()) {
            Log.d(TAG, "FCM message contains no data payload; skipping.")
            return
        }

        val type = data["type"] ?: ""
        val action = data["alarm_action"] ?: data["action"] ?: ""

        if (type == "REMOTE_SIREN" || action.equals("START", ignoreCase = true) || action.equals("STOP", ignoreCase = true)) {
            handleRemoteSirenAction(action)
        }
    }

    private fun handleRemoteSirenAction(action: String) {
        Log.d(TAG, "🔊 Processing Remote Siren FCM command: action=$action")

        val isStart = action.equals("START", ignoreCase = true)
        val context = applicationContext

        // Acquire temporary 10-second WakeLock to guarantee CPU execution
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        val wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "SafeCircle::RemoteSirenWakeLock"
        )
        wakeLock.acquire(10 * 1000L)

        try {
            if (isStart) {
                // 1. Direct in-process alarm trigger (if MotionForegroundService is alive)
                MotionForegroundService.triggerAlarmDirectly("FCM Remote Siren Background Command")

                // 2. Start / ensure MotionForegroundService is active with ACTION_START_ALARM
                val serviceIntent = Intent(context, MotionForegroundService::class.java).apply {
                    this.action = MotionForegroundService.ACTION_START_ALARM
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }

                // 3. Trigger native hardware vibration
                vibrateDevice(true)
            } else {
                // 1. Direct in-process stop
                MotionForegroundService.stopAlarmDirectly()

                // 2. Intent fallback to ensure service handles stop
                val serviceIntent = Intent(context, MotionForegroundService::class.java).apply {
                    this.action = MotionForegroundService.ACTION_STOP_ALARM
                }
                context.startService(serviceIntent)

                // 3. Cancel vibration
                vibrateDevice(false)
            }
        } catch (e: Exception) {
            Log.e(TAG, "❌ Error executing remote siren FCM action: ${e.message}", e)
        } finally {
            if (wakeLock.isHeld) {
                try { wakeLock.release() } catch (_: Exception) {}
            }
        }
    }

    private fun vibrateDevice(start: Boolean) {
        try {
            val vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator
            } else {
                @Suppress("DEPRECATION")
                getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
            }

            if (start) {
                val timings = longArrayOf(0, 800, 300, 800)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(timings, 0))
                } else {
                    @Suppress("DEPRECATION")
                    vibrator.vibrate(timings, 0)
                }
            } else {
                vibrator.cancel()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Could not control device vibration: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "SafeCircleMessaging"
    }
}
