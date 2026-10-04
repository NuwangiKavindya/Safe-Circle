package com.safecircleapp

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.*

class TorchModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private var isTorchOn: Boolean = false
    private var cameraIdWithFlash: String? = null

    override fun getName(): String {
        return "TorchModule"
    }

    private fun getCameraId(): String? {
        if (cameraIdWithFlash != null) return cameraIdWithFlash
        try {
            val cameraManager = reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            for (id in cameraManager.cameraIdList) {
                val characteristics = cameraManager.getCameraCharacteristics(id)
                val hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false
                val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
                if (hasFlash && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    cameraIdWithFlash = id
                    return id
                }
            }
            // Fallback to any camera with flash if no back camera found
            for (id in cameraManager.cameraIdList) {
                val characteristics = cameraManager.getCameraCharacteristics(id)
                val hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ?: false
                if (hasFlash) {
                    cameraIdWithFlash = id
                    return id
                }
            }
        } catch (e: Exception) {
            Log.e("TorchModule", "Error finding camera with flash: ${e.message}")
        }
        return null
    }

    @ReactMethod
    fun isAvailable(promise: Promise) {
        val id = getCameraId()
        promise.resolve(id != null)
    }

    @ReactMethod
    fun setTorchMode(enabled: Boolean, promise: Promise) {
        try {
            val cameraManager = reactContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager
            val id = getCameraId()
            if (id == null) {
                promise.resolve(false)
                return
            }
            cameraManager.setTorchMode(id, enabled)
            isTorchOn = enabled
            Log.d("TorchModule", "Torch state set to: $enabled")
            promise.resolve(isTorchOn)
        } catch (e: Exception) {
            Log.e("TorchModule", "Failed to set torch mode: ${e.message}")
            promise.reject("ERR_TORCH", e.message, e)
        }
    }

    @ReactMethod
    fun toggleTorch(promise: Promise) {
        setTorchMode(!isTorchOn, promise)
    }

    @ReactMethod
    fun isTorchActive(promise: Promise) {
        promise.resolve(isTorchOn)
    }
}
