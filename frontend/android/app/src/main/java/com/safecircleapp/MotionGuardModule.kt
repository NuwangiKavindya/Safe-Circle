package com.safecircleapp

import android.content.Intent
import android.util.Log
import com.facebook.react.bridge.*
import org.tensorflow.lite.Interpreter
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel

class MotionGuardModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    private var tfliteInterpreter: Interpreter? = null
    private var tfliteInputScale: Float = 1.0f
    private var tfliteInputZeroPoint: Int = 0

    // Z-score normalization constants from ml/normalization_constants.json (Channel order: [ax, ay, az])
    private val NORM_MEAN = floatArrayOf(0.0029192413f, 3.3800392151f, 9.0580043793f)
    private val NORM_STD  = floatArrayOf(2.0943772793f, 2.6760475635f, 2.9341847897f)

    init {
        MotionForegroundService.activeReactContext = reactContext
    }

    override fun getName(): String {
        return "MotionGuardModule"
    }

    private fun getInterpreter(): Interpreter? {
        if (tfliteInterpreter != null) return tfliteInterpreter

        return try {
            val assetFileDescriptor = reactApplicationContext.assets.openFd("theft_detector.tflite")
            val fileInputStream = FileInputStream(assetFileDescriptor.fileDescriptor)
            val fileChannel = fileInputStream.channel
            val startOffset = assetFileDescriptor.startOffset
            val declaredLength = assetFileDescriptor.declaredLength
            val modelBuffer = fileChannel.map(FileChannel.MapMode.READ_ONLY, startOffset, declaredLength)
            fileInputStream.close()

            val options = Interpreter.Options().apply {
                setNumThreads(2)
            }
            val interpreter = Interpreter(modelBuffer, options)

            // Read input tensor quantization parameters (scale + zero-point)
            val inTensor = interpreter.getInputTensor(0)
            val qParams = inTensor.quantizationParams()
            tfliteInputScale = qParams.scale
            tfliteInputZeroPoint = qParams.zeroPoint

            tfliteInterpreter = interpreter
            Log.d(
                "MotionGuardModule",
                "✅ Stage 2 TensorFlow Lite model (theft_detector.tflite) loaded. " +
                "Input shape: ${inTensor.shape().toList()}, Scale: $tfliteInputScale, ZP: $tfliteInputZeroPoint"
            )
            tfliteInterpreter
        } catch (e: Exception) {
            Log.w("MotionGuardModule", "TFLite model asset (theft_detector.tflite) failed to load: ${e.message}")
            null
        }
    }

    @ReactMethod
    fun runTFLiteInference(bufferArray: ReadableArray, promise: Promise) {
        try {
            val interpreter = getInterpreter()
            val windowSize = 100
            val numFeatures = 3

            if (interpreter != null) {
                // Real on-device TFLite neural inference with theft_detector.tflite [1,100,3] INT8
                val inputBuffer = ByteBuffer.allocateDirect(1 * windowSize * numFeatures * 1).apply {
                    order(ByteOrder.nativeOrder())
                }

                val count = Math.min(bufferArray.size(), windowSize)
                for (i in 0 until count) {
                    val map = bufferArray.getMap(i)
                    val ax = if (map != null && map.hasKey("ax")) map.getDouble("ax").toFloat() else 0f
                    val ay = if (map != null && map.hasKey("ay")) map.getDouble("ay").toFloat() else 0f
                    val az = if (map != null && map.hasKey("az")) map.getDouble("az").toFloat() else 9.81f

                    val raw = floatArrayOf(ax, ay, az)
                    for (c in 0 until numFeatures) {
                        val norm = (raw[c] - NORM_MEAN[c]) / NORM_STD[c]
                        val q = if (tfliteInputScale != 0f) {
                            Math.round(norm / tfliteInputScale) + tfliteInputZeroPoint
                        } else {
                            Math.round(norm).toInt()
                        }
                        inputBuffer.put(q.coerceIn(-128, 127).toByte())
                    }
                }

                // Zero-pad remaining frames if buffer < windowSize
                val padCount = windowSize - count
                for (i in 0 until padCount * numFeatures) {
                    inputBuffer.put(0.toByte())
                }
                inputBuffer.rewind()

                // theft_detector.tflite output tensor: [1, 1] sigmoid probability
                val outputArray = Array(1) { FloatArray(1) }
                val start = System.nanoTime()
                interpreter.run(inputBuffer, outputArray)
                val latencyMs = (System.nanoTime() - start) / 1_000_000.0

                val snatchProb = outputArray[0][0].toDouble()
                val isAnomaly = snatchProb >= 0.50

                val result = Arguments.createMap().apply {
                    putBoolean("isAnomaly", isAnomaly)
                    putDouble("confidenceScore", snatchProb)
                    putDouble("latencyMs", latencyMs)
                    putString("detectionSource", "STAGE_2_TFLITE_MODEL")
                }
                promise.resolve(result)
                return
            }

            // Fallback feature analysis if native interpreter is uninitialized
            var maxNetAccel = 0.0
            var maxGyro = 0.0
            for (i in 0 until bufferArray.size()) {
                val map = bufferArray.getMap(i)
                if (map != null) {
                    val ax = if (map.hasKey("ax")) map.getDouble("ax") else 0.0
                    val ay = if (map.hasKey("ay")) map.getDouble("ay") else 0.0
                    val az = if (map.hasKey("az")) map.getDouble("az") else 0.0
                    val gx = if (map.hasKey("gx")) map.getDouble("gx") else 0.0
                    val gy = if (map.hasKey("gy")) map.getDouble("gy") else 0.0
                    val gz = if (map.hasKey("gz")) map.getDouble("gz") else 0.0

                    val netA = Math.max(0.0, Math.sqrt(ax * ax + ay * ay + az * az) - 9.81)
                    val netG = Math.sqrt(gx * gx + gy * gy + gz * gz)
                    if (netA > maxNetAccel) maxNetAccel = netA
                    if (netG > maxGyro) maxGyro = netG
                }
            }

            val isAnom = maxNetAccel > 22.0 && maxGyro > 7.0
            val conf = if (isAnom) Math.min(0.98, 0.82 + (maxNetAccel / 100.0)) else 0.15

            val fallbackResult = Arguments.createMap().apply {
                putBoolean("isAnomaly", isAnom)
                putDouble("confidenceScore", conf)
                putDouble("latencyMs", -1.0)
                putString("detectionSource", "HEURISTIC_FALLBACK")
            }
            promise.resolve(fallbackResult)

        } catch (e: Exception) {
            promise.reject("ERR_TFLITE_INFERENCE", e.message, e)
        }
    }

    @ReactMethod
    fun startBackgroundMonitoring(sensitivityMode: String, promise: Promise) {
        try {
            MotionForegroundService.activeReactContext = reactApplicationContext
            val intent = Intent(reactApplicationContext, MotionForegroundService::class.java).apply {
                action = MotionForegroundService.ACTION_START
                putExtra(MotionForegroundService.EXTRA_SENSITIVITY_MODE, sensitivityMode)
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_FOREGROUND_SERVICE_START", e.message, e)
        }
    }

    @ReactMethod
    fun stopBackgroundMonitoring(promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, MotionForegroundService::class.java).apply {
                action = MotionForegroundService.ACTION_STOP
            }
            reactApplicationContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_FOREGROUND_SERVICE_STOP", e.message, e)
        }
    }

    @ReactMethod
    fun setTrackingMode(mode: String, promise: Promise) {
        try {
            val intent = Intent(reactApplicationContext, MotionForegroundService::class.java).apply {
                action = MotionForegroundService.ACTION_SET_TRACKING_MODE
                putExtra(MotionForegroundService.EXTRA_TRACKING_MODE, mode)
            }
            reactApplicationContext.startService(intent)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("ERR_TRACKING_MODE", e.message, e)
        }
    }

    @ReactMethod
    fun isServiceRunning(promise: Promise) {
        promise.resolve(MotionForegroundService.isServiceRunning)
    }

    /**
     * stopNativeAlarm — JS bridge method to silence the MotionForegroundService's
     * internal nativeToneGenerator from React Native.
     *
     * Why this is needed:
     *   When a theft anomaly fires, the service calls triggerNativeAlarm() which
     *   owns its own ToneGenerator on STREAM_ALARM. AlarmSoundModule.stopSound()
     *   only stops AlarmSoundModule's separate ToneGenerator — it has no reference
     *   to the service's generator. This method closes that gap.
     *
     * Two-path stop for maximum reliability:
     *   1. Direct call via companion object stopAlarmDirectly() — zero-latency,
     *      works when the service is alive in the same process (the common case).
     *   2. Intent ACTION_STOP_NATIVE_ALARM fallback — covers the rare edge case
     *      where the service is alive but the companion reference is stale.
     */
    @ReactMethod
    fun stopNativeAlarm(promise: Promise) {
        try {
            // Path 1: Direct in-process call — fastest, no IPC overhead.
            MotionForegroundService.stopAlarmDirectly()

            // Path 2: Intent-based fallback — ensures the service's onStartCommand
            // also processes the stop even if the direct call missed.
            val intent = Intent(reactApplicationContext, MotionForegroundService::class.java).apply {
                action = MotionForegroundService.ACTION_STOP_ALARM
            }
            reactApplicationContext.startService(intent)

            Log.d("MotionGuardModule", "🔕 stopNativeAlarm: service native alarm silenced (both paths).")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.w("MotionGuardModule", "stopNativeAlarm error: ${e.message}")
            promise.reject("ERR_STOP_NATIVE_ALARM", e.message, e)
        }
    }

    /**
     * triggerNativeAlarm — JS bridge method to activate MotionForegroundService's
     * internal nativeToneGenerator from React Native.
     */
    @ReactMethod
    fun triggerNativeAlarm(promise: Promise) {
        try {
            MotionForegroundService.triggerAlarmDirectly("Remote Siren Triggered from React Native")
            val intent = Intent(reactApplicationContext, MotionForegroundService::class.java).apply {
                action = MotionForegroundService.ACTION_START_ALARM
            }
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                reactApplicationContext.startForegroundService(intent)
            } else {
                reactApplicationContext.startService(intent)
            }
            Log.d("MotionGuardModule", "🚨 triggerNativeAlarm: native alarm ToneGenerator triggered.")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.w("MotionGuardModule", "triggerNativeAlarm error: ${e.message}")
            promise.reject("ERR_TRIGGER_NATIVE_ALARM", e.message, e)
        }
    }
}

