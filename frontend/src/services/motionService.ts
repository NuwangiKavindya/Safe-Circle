import { NativeModules, DeviceEventEmitter, Platform } from 'react-native';
import { loadTensorflowModel, TfliteModel } from 'react-native-fast-tflite';

const { MotionGuardModule } = NativeModules;

export interface MotionSample {
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
  timestamp: number;
}

export type SensitivityMode = 'TABLE_GUARD' | 'POCKET_GUARD' | 'ACTIVE_GUARD';

export interface SensitivityProfile {
  name: string;
  label: string;
  icon: string;
  accelThreshold: number;  // m/s^2 above gravity
  jerkThreshold: number;   // m/s^3
  angularThreshold: number; // rad/s
}

export interface AnomalyDetectionResult {
  isAnomaly: boolean;
  confidenceScore: number; // 0.0 to 1.0
  detectionSource: 'STAGE_1_FAST_PATH' | 'STAGE_2_TFLITE_MODEL' | 'HEURISTIC_FALLBACK';
  reason: string;
  sensitivityMode: SensitivityMode;
}

export const SENSITIVITY_PROFILES: Record<SensitivityMode, SensitivityProfile> = {
  TABLE_GUARD: {
    name: 'TABLE_GUARD',
    label: 'Table Guard',
    icon: '☕',
    accelThreshold: 12.0,  // High sensitivity for resting phone on table
    jerkThreshold: 60.0,
    angularThreshold: 4.5,
  },
  POCKET_GUARD: {
    name: 'POCKET_GUARD',
    label: 'Pocket Mode',
    icon: '🚶',
    accelThreshold: 22.0,  // Medium sensitivity for walking / pocket
    jerkThreshold: 110.0,
    angularThreshold: 7.5,
  },
  ACTIVE_GUARD: {
    name: 'ACTIVE_GUARD',
    label: 'Active Mode',
    icon: '🏃',
    accelThreshold: 35.0,  // Low sensitivity for running / exercise
    jerkThreshold: 180.0,
    angularThreshold: 11.0,
  },
};

let sensorsModule: any = null;
try {
  sensorsModule = require('react-native-sensors');
} catch (e) {
  sensorsModule = null;
}

class MotionService {
  // ── TFLite model configuration ──────────────────────────────────────────────
  // Normalization constants derived from the training set (P01, 50 Hz, ax/ay/az only).
  // Source: ml/normalization_constants.json — regenerate if the model is retrained.
  private static readonly NORM_MEAN = [0.0029192413203418255, 3.3800392150878906, 9.058004379272461];
  private static readonly NORM_STD  = [2.094377279281616,     2.6760475635528564, 2.9341847896575928];

  // Sigmoid output threshold for classifying a window as THEFT.
  // Tune this constant to trade recall vs. false alarm rate.
  // Training result: recall=100%, false alarm rate=3.7% at 0.5; raised to 0.85 for deployment.
  private static readonly THEFT_THRESHOLD = 0.85;

  private tfliteModel: TfliteModel | null = null;
  private tfliteLoadAttempted: boolean = false;

  // ── Sensor / monitoring state ────────────────────────────────────────────────
  private accelSubscription: any = null;
  private gyroSubscription: any = null;
  private nativeAnomalySub: any = null;
  private nativeEnergySub: any = null;

  private isMonitoring: boolean = false;
  private sampleBuffer: MotionSample[] = [];
  private lastSample: { ax: number; ay: number; az: number; time: number } | null = null;

  private onAnomalyCallback: ((result: AnomalyDetectionResult) => void) | null = null;
  private onEnergyUpdateCallback: ((energyLevel: number) => void) | null = null;
  private simulationInterval: any = null;

  private currentMode: SensitivityMode = 'POCKET_GUARD';
  private userBaselineOffset: number = 0;
  private isCalibrating: boolean = false;
  private calibrationSamples: number[] = [];

  private readonly DEBOUNCE_MS = 5000;
  private lastTriggerTime: number = 0;

  public setSensitivityMode(mode: SensitivityMode) {
    this.currentMode = mode;
    console.log(`[MotionService] Sensitivity profile updated to: ${mode}`);
    // If native foreground service is active, update service mode
    if (Platform.OS === 'android' && MotionGuardModule) {
      MotionGuardModule.startBackgroundMonitoring(mode).catch(() => {});
    }
  }

  public getSensitivityMode(): SensitivityMode {
    return this.currentMode;
  }

  /**
   * Start Motion Sensor Monitoring (with Native Android Foreground Service & Partial WakeLock)
   */
  public startMonitoring(
    onAnomalyDetected: (result: AnomalyDetectionResult) => void,
    onEnergyUpdate?: (energyLevel: number) => void
  ): boolean {
    if (this.isMonitoring) {
      console.log('[MotionService] Motion Guard already active.');
      return true;
    }

    this.onAnomalyCallback = onAnomalyDetected;
    this.onEnergyUpdateCallback = onEnergyUpdate || null;
    this.isMonitoring = true;
    this.sampleBuffer = [];
    this.lastSample = null;

    // 1. Trigger Native Android Sticky Foreground Service + Partial WakeLock
    if (Platform.OS === 'android' && MotionGuardModule) {
      try {
        MotionGuardModule.startBackgroundMonitoring(this.currentMode)
          .then(() => console.log('[MotionService] 🚀 Native Android Foreground Service & Partial WakeLock started.'))
          .catch((err: any) => console.warn('[MotionService] Failed to start native foreground service:', err));

        // Listen for Native Android Service Events
        this.nativeAnomalySub = DeviceEventEmitter.addListener('onMotionAnomalyDetected', (eventData: AnomalyDetectionResult) => {
          console.warn('[MotionService] 🚨 Native Foreground Anomaly Event:', eventData.reason);
          if (this.onAnomalyCallback) {
            this.onAnomalyCallback(eventData);
          }
        });

        this.nativeEnergySub = DeviceEventEmitter.addListener('onMotionEnergyUpdated', (data: { energyLevel: number }) => {
          if (this.onEnergyUpdateCallback) {
            this.onEnergyUpdateCallback(data.energyLevel);
          }
        });
      } catch (err: any) {
        console.warn('[MotionService] Native module attachment error:', err);
      }
    }

    // 2. React Native JS Thread Fallback Listener (when in foreground)
    if (sensorsModule && sensorsModule.accelerometer && sensorsModule.gyroscope) {
      try {
        const { accelerometer, gyroscope, SensorTypes, setUpdateIntervalForType } = sensorsModule;
        setUpdateIntervalForType(SensorTypes.accelerometer, 20); // 50Hz
        setUpdateIntervalForType(SensorTypes.gyroscope, 20);     // 50Hz

        let currentGyro = { gx: 0, gy: 0, gz: 0 };

        this.gyroSubscription = gyroscope.subscribe(
          ({ x, y, z }: { x: number; y: number; z: number }) => {
            currentGyro = { gx: x, gy: y, gz: z };
          },
          (err: any) => console.warn('[MotionService] Gyroscope stream error:', err.message || err)
        );

        this.accelSubscription = accelerometer.subscribe(
          ({ x, y, z }: { x: number; y: number; z: number }) => {
            this.processSensorFrame(x, y, z, currentGyro.gx, currentGyro.gy, currentGyro.gz);
          },
          (err: any) => console.warn('[MotionService] Accelerometer stream error:', err.message || err)
        );

        console.log('[MotionService] 🛡️ Hardware Motion Sensors listening at 50Hz.');
        return true;
      } catch (err: any) {
        console.warn('[MotionService] Error attaching native sensors:', err.message || err);
      }
    }

    // Fallback: Start background simulated motion loop (for emulator / dev testing)
    console.log('[MotionService] 🛡️ Simulated Motion Guard active for testing.');
    this.simulationInterval = setInterval(() => {
      const noiseX = (Math.random() - 0.5) * 0.3;
      const noiseY = (Math.random() - 0.5) * 0.3;
      const noiseZ = 9.81 + (Math.random() - 0.5) * 0.3;
      this.processSensorFrame(noiseX, noiseY, noiseZ, 0.02, 0.02, 0.02);
    }, 20);

    return true;
  }

  /**
   * Stop Motion Guard Monitoring & Foreground Service
   */
  public stopMonitoring() {
    if (Platform.OS === 'android' && MotionGuardModule) {
      try {
        MotionGuardModule.stopBackgroundMonitoring()
          .then(() => console.log('[MotionService] 🛑 Native Android Foreground Service stopped.'))
          .catch((err: any) => console.warn('[MotionService] Error stopping native foreground service:', err));
      } catch (err: any) {
        console.warn('[MotionService] Native module stop error:', err);
      }
    }

    if (this.nativeAnomalySub) {
      this.nativeAnomalySub.remove();
      this.nativeAnomalySub = null;
    }
    if (this.nativeEnergySub) {
      this.nativeEnergySub.remove();
      this.nativeEnergySub = null;
    }

    if (this.accelSubscription && typeof this.accelSubscription.unsubscribe === 'function') {
      this.accelSubscription.unsubscribe();
    }
    if (this.gyroSubscription && typeof this.gyroSubscription.unsubscribe === 'function') {
      this.gyroSubscription.unsubscribe();
    }
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
      this.simulationInterval = null;
    }
    this.accelSubscription = null;
    this.gyroSubscription = null;
    this.isMonitoring = false;
    this.sampleBuffer = [];
    this.lastSample = null;
    console.log('[MotionService] 🛑 Motion Guard stopped.');
  }

  public isGuardActive(): boolean {
    return this.isMonitoring;
  }

  /**
   * Start 3-Second User Baseline Calibration
   */
  public calibrateUserBaseline(onComplete: (baselineOffset: number) => void) {
    this.isCalibrating = true;
    this.calibrationSamples = [];
    console.log('[MotionService] 🎯 Calibrating user baseline for 3 seconds...');

    setTimeout(() => {
      this.isCalibrating = false;
      if (this.calibrationSamples.length > 0) {
        const mean = this.calibrationSamples.reduce((a, b) => a + b, 0) / this.calibrationSamples.length;
        this.userBaselineOffset = parseFloat(mean.toFixed(2));
        console.log(`[MotionService] ✅ Baseline calibration complete: offset ${this.userBaselineOffset} m/s²`);
        onComplete(this.userBaselineOffset);
      } else {
        onComplete(0);
      }
    }, 3000);
  }

  /**
   * Core Feature Extraction Engine
   */
  private processSensorFrame(
    ax: number,
    ay: number,
    az: number,
    gx: number,
    gy: number,
    gz: number
  ) {
    const now = Date.now();

    const rawMagnitude = Math.sqrt(ax * ax + ay * ay + az * az);
    const netAccel = Math.max(0, rawMagnitude - 9.81 - this.userBaselineOffset);

    if (this.isCalibrating) {
      this.calibrationSamples.push(netAccel);
    }

    let jerk = 0;
    if (this.lastSample) {
      const dt = (now - this.lastSample.time) / 1000;
      if (dt > 0) {
        const prevNet = Math.max(0, Math.sqrt(this.lastSample.ax ** 2 + this.lastSample.ay ** 2 + this.lastSample.az ** 2) - 9.81);
        jerk = Math.abs(netAccel - prevNet) / dt;
      }
    }

    const angularVelocity = Math.sqrt(gx * gx + gy * gy + gz * gz);

    const profile = SENSITIVITY_PROFILES[this.currentMode];
    const energyPercentage = Math.min(100, Math.round((netAccel / profile.accelThreshold) * 100));

    if (this.onEnergyUpdateCallback) {
      this.onEnergyUpdateCallback(energyPercentage);
    }

    const sample: MotionSample = { ax, ay, az, gx, gy, gz, timestamp: now };
    this.sampleBuffer.push(sample);
    if (this.sampleBuffer.length > 100) {
      this.sampleBuffer.shift();
    }

    this.lastSample = { ax, ay, az, time: now };

    if (now - this.lastTriggerTime < this.DEBOUNCE_MS) {
      return;
    }

    if (
      netAccel > profile.accelThreshold &&
      jerk > profile.jerkThreshold &&
      angularVelocity > profile.angularThreshold
    ) {
      this.lastTriggerTime = now;
      const result: AnomalyDetectionResult = {
        isAnomaly: true,
        confidenceScore: 0.95,
        detectionSource: 'STAGE_1_FAST_PATH',
        reason: `Violent Snatch Gesture in ${profile.label} (Accel: ${netAccel.toFixed(1)} m/s², Jerk: ${jerk.toFixed(1)} m/s³)`,
        sensitivityMode: this.currentMode,
      };

      console.warn(`[MotionService] 🚨 ${result.reason}`);
      if (this.onAnomalyCallback) {
        this.onAnomalyCallback(result);
      }
      return;
    }

    if (this.sampleBuffer.length === 100 && this.sampleBuffer.length % 20 === 0) {
      this.evaluateTFLiteModel(profile);
    }
  }

  /**
   * Lazy-load the TFLite model once and cache it for the lifetime of the service.
   * Logs a startup confirmation line so you can verify in Metro/logcat
   * that the real model is active before a recording session.
   */
  private async getTFLiteModel(): Promise<TfliteModel | null> {
    if (this.tfliteModel) return this.tfliteModel;
    if (this.tfliteLoadAttempted) return null; // don't retry after a load failure
    this.tfliteLoadAttempted = true;
    try {
      // Metro resolves this require() because 'tflite' is in metro.config.js assetExts.
      // The model was trained on 3-channel (ax, ay, az) 50 Hz windows, INT8 quantized.
      this.tfliteModel = await loadTensorflowModel(
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('../assets/theft_detector.tflite'),
        [] // empty → default CPU delegate
      );
      console.log(
        '[MotionService] ✅ theft_detector.tflite loaded — ' +
        'detectionSource will be STAGE_2_TFLITE_MODEL. ' +
        `THEFT_THRESHOLD=${MotionService.THEFT_THRESHOLD}`
      );
      return this.tfliteModel;
    } catch (err: any) {
      console.error(
        '[MotionService] ❌ FAILED to load theft_detector.tflite. ' +
        'All Stage-2 detections will use HEURISTIC_FALLBACK, not the trained CNN. ' +
        'Check that metro.config.js has tflite in assetExts and the file exists at ' +
        'src/assets/theft_detector.tflite. Error:', err?.message ?? err
      );
      return null;
    }
  }

  private async evaluateTFLiteModel(profile: SensitivityProfile) {
    if (this.sampleBuffer.length < 100) return;

    const model = await this.getTFLiteModel();

    if (model) {
      // ── Real on-device CNN inference via react-native-fast-tflite ──────────
      try {
        // Build a flat Float32Array of shape (1, 100, 3) in row-major order.
        // Apply the z-score normalisation from ml/normalization_constants.json:
        //   x_norm = (x - mean) / std
        // The model's INT8 quantisation is applied internally by the TFLite runtime.
        const window = this.sampleBuffer.slice(-100); // guaranteed 100 frames
        const inputData = new Float32Array(100 * 3);
        for (let i = 0; i < 100; i++) {
          inputData[i * 3 + 0] = (window[i].ax - MotionService.NORM_MEAN[0]) / MotionService.NORM_STD[0];
          inputData[i * 3 + 1] = (window[i].ay - MotionService.NORM_MEAN[1]) / MotionService.NORM_STD[1];
          inputData[i * 3 + 2] = (window[i].az - MotionService.NORM_MEAN[2]) / MotionService.NORM_STD[2];
        }

        const t0 = Date.now();
        const outputs = await model.run([inputData.buffer]); // run() expects ArrayBuffer[]
        const latencyMs = Date.now() - t0;

        // Output tensor: sigmoid scalar, shape (1, 1).
        // Wrap the returned ArrayBuffer in Float32Array to read the theft probability.
        const theftProb = new Float32Array(outputs[0])[0];
        console.log(
          `[MotionService] TFLite inference: theft_prob=${theftProb.toFixed(4)} ` +
          `threshold=${MotionService.THEFT_THRESHOLD} latency=${latencyMs}ms`
        );

        if (theftProb >= MotionService.THEFT_THRESHOLD) {
          const now = Date.now();
          if (now - this.lastTriggerTime < this.DEBOUNCE_MS) return;
          this.lastTriggerTime = now;
          const result: AnomalyDetectionResult = {
            isAnomaly: true,
            confidenceScore: parseFloat(theftProb.toFixed(3)),
            detectionSource: 'STAGE_2_TFLITE_MODEL',
            reason: `CNN theft pattern — ${profile.label} [${latencyMs}ms] (p=${(theftProb * 100).toFixed(1)}%, threshold=${(MotionService.THEFT_THRESHOLD * 100).toFixed(0)}%)`,
            sensitivityMode: this.currentMode,
          };
          console.warn('[MotionService] 🤖 STAGE_2_TFLITE_MODEL anomaly:', result.reason);
          this.onAnomalyCallback?.(result);
        }
        return; // do NOT fall through to heuristic when model is healthy
      } catch (err: any) {
        console.error(
          '[MotionService] ❌ TFLite runtime error during inference — ' +
          'falling back to HEURISTIC_FALLBACK. This detection will NOT come from the trained CNN. ' +
          'Error:', err?.message ?? err
        );
      }
    }

    // ── Heuristic fallback — only reached when the TFLite model failed to load or threw ──
    // detectionSource is explicitly 'HEURISTIC_FALLBACK', never 'STAGE_2_TFLITE_MODEL',
    // so you can distinguish real-model detections from heuristic ones in logs and the UI.
    console.warn(
      '[MotionService] ⚠️  HEURISTIC_FALLBACK in use — TFLite model is NOT running. ' +
      'Do not cite this detection as CNN inference in your thesis.'
    );
    const accelVariance = this.calculateBufferVariance(
      this.sampleBuffer.map(s => Math.sqrt(s.ax ** 2 + s.ay ** 2 + s.az ** 2))
    );
    const varianceLimit = profile.accelThreshold * 0.8;
    if (accelVariance > varianceLimit) {
      const now = Date.now();
      if (now - this.lastTriggerTime < this.DEBOUNCE_MS) return;
      this.lastTriggerTime = now;
      const confidence = Math.min(0.75, 0.55 + accelVariance / 200);
      const result: AnomalyDetectionResult = {
        isAnomaly: true,
        confidenceScore: parseFloat(confidence.toFixed(2)),
        detectionSource: 'HEURISTIC_FALLBACK',
        reason: `Heuristic variance anomaly — ${profile.label} (TFLite model unavailable; NOT CNN inference)`,
        sensitivityMode: this.currentMode,
      };
      console.warn('[MotionService] ⚠️  HEURISTIC_FALLBACK anomaly:', result.reason);
      this.onAnomalyCallback?.(result);
    }
  }

  private calculateBufferVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const sqDiffs = values.map(val => (val - mean) ** 2);
    return sqDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }

  public async setTrackingMode(mode: 'EMERGENCY_SOS' | 'PASSIVE_MONITORING'): Promise<boolean> {
    if (Platform.OS !== 'android' || !MotionGuardModule) return false;
    try {
      return await MotionGuardModule.setTrackingMode(mode);
    } catch (e: any) {
      console.warn('[MotionService] Error setting native tracking mode:', e?.message || e);
      return false;
    }
  }
}

export const motionService = new MotionService();
