#!/usr/bin/env python3
"""
SafeCircle Stage 2 Quantized TensorFlow Lite (TFLite) Anomaly Detection Model
Trains a 1D Convolutional Neural Network on 6-axis IMU time-series windows [ax, ay, az, gx, gy, gz]
and quantizes it into an ultra-low-latency on-device .tflite model (< 15 ms inference).
"""

import os
import time
import numpy as np

def generate_imu_dataset(num_samples=2000, window_size=100):
    """
    Synthesizes calibrated 6-axis IMU training data:
    Class 0: Benign Locomotion (Walking, sitting, desk resting, pocket jostle)
    Class 1: Theft Snatch Anomaly (Aggressive snatch, sudden jerk grab, violent flip)
    """
    np.random.seed(42)
    X = np.zeros((num_samples, window_size, 6), dtype=np.float32)
    y = np.zeros((num_samples, 2), dtype=np.float32)

    half = num_samples // 2

    # --- Class 0: Benign Locomotion ---
    for i in range(half):
        sub_type = i % 4
        t = np.linspace(0, 2.0, window_size)

        if sub_type == 0:
            # Steady walking (periodic ~1.8 Hz foot strikes)
            freq = 1.8 + np.random.uniform(-0.2, 0.2)
            ax = 0.8 * np.sin(2 * np.pi * freq * t) + np.random.normal(0, 0.2, window_size)
            ay = 9.81 + 1.5 * np.cos(2 * np.pi * freq * t) + np.random.normal(0, 0.3, window_size)
            az = 0.5 * np.sin(2 * np.pi * freq * t + 0.5) + np.random.normal(0, 0.2, window_size)
            gx = 0.8 * np.sin(2 * np.pi * freq * t) + np.random.normal(0, 0.1, window_size)
            gy = 0.6 * np.cos(2 * np.pi * freq * t) + np.random.normal(0, 0.1, window_size)
            gz = 0.3 * np.sin(2 * np.pi * freq * t) + np.random.normal(0, 0.05, window_size)

        elif sub_type == 1:
            # Phone resting flat on table (pure gravity on Z/Y, tiny sensor noise)
            ax = np.random.normal(0, 0.05, window_size)
            ay = np.random.normal(0, 0.05, window_size)
            az = 9.81 + np.random.normal(0, 0.05, window_size)
            gx = np.random.normal(0, 0.02, window_size)
            gy = np.random.normal(0, 0.02, window_size)
            gz = np.random.normal(0, 0.02, window_size)

        elif sub_type == 2:
            # Phone in pocket while standing / gentle swaying
            ax = np.random.normal(0, 0.15, window_size)
            ay = 9.81 + np.random.normal(0, 0.2, window_size)
            az = np.random.normal(0, 0.15, window_size)
            gx = np.random.normal(0, 0.1, window_size)
            gy = np.random.normal(0, 0.1, window_size)
            gz = np.random.normal(0, 0.08, window_size)

        else:
            # Gentle phone pickup / typing
            ax = np.linspace(0, 1.2, window_size) + np.random.normal(0, 0.1, window_size)
            ay = 9.81 + np.linspace(0, -1.0, window_size) + np.random.normal(0, 0.15, window_size)
            az = np.linspace(0, 1.5, window_size) + np.random.normal(0, 0.1, window_size)
            gx = np.random.normal(0, 0.3, window_size)
            gy = np.random.normal(0, 0.25, window_size)
            gz = np.random.normal(0, 0.2, window_size)

        X[i, :, 0] = ax
        X[i, :, 1] = ay
        X[i, :, 2] = az
        X[i, :, 3] = gx
        X[i, :, 4] = gy
        X[i, :, 5] = gz
        y[i, 0] = 1.0  # Benign

    # --- Class 1: Theft Snatch Anomalies ---
    for i in range(half, num_samples):
        sub_type = i % 3
        t = np.linspace(0, 2.0, window_size)
        snatch_start = np.random.randint(25, 65)
        snatch_duration = np.random.randint(10, 25)

        # Baseline pocket/hand movement prior to grab
        ax = np.random.normal(0, 0.5, window_size)
        ay = 9.81 + np.random.normal(0, 0.8, window_size)
        az = np.random.normal(0, 0.5, window_size)
        gx = np.random.normal(0, 0.5, window_size)
        gy = np.random.normal(0, 0.5, window_size)
        gz = np.random.normal(0, 0.5, window_size)

        # Violent snatch signature injection
        s_end = min(window_size, snatch_start + snatch_duration)
        if sub_type == 0:
            # Rapid upward pocket extraction snatch (massive Y-jerk & Z-rotation)
            ay[snatch_start:s_end] += np.random.uniform(22.0, 42.0, s_end - snatch_start)
            ax[snatch_start:s_end] += np.random.uniform(-18.0, 18.0, s_end - snatch_start)
            gz[snatch_start:s_end] += np.random.uniform(9.0, 16.0, s_end - snatch_start)
            gx[snatch_start:s_end] += np.random.uniform(-10.0, 10.0, s_end - snatch_start)

        elif sub_type == 1:
            # Horizontal motorcycle / bicycle grab-and-run
            ax[snatch_start:s_end] += np.random.uniform(25.0, 48.0, s_end - snatch_start)
            ay[snatch_start:s_end] += np.random.uniform(15.0, 35.0, s_end - snatch_start)
            gy[snatch_start:s_end] += np.random.uniform(8.0, 15.0, s_end - snatch_start)

        else:
            # Table swipe & rotational fling
            ax[snatch_start:s_end] += np.random.uniform(-30.0, 30.0, s_end - snatch_start)
            az[snatch_start:s_end] += np.random.uniform(20.0, 40.0, s_end - snatch_start)
            gx[snatch_start:s_end] += np.random.uniform(10.0, 18.0, s_end - snatch_start)
            gz[snatch_start:s_end] += np.random.uniform(-12.0, 12.0, s_end - snatch_start)

        X[i, :, 0] = ax
        X[i, :, 1] = ay
        X[i, :, 2] = az
        X[i, :, 3] = gx
        X[i, :, 4] = gy
        X[i, :, 5] = gz
        y[i, 1] = 1.0  # Anomaly (Snatch)

    # Shuffle dataset
    indices = np.arange(num_samples)
    np.random.shuffle(indices)
    return X[indices], y[indices]

def main():
    import tensorflow as tf
    print(f"TensorFlow Version: {tf.__version__}")

    print("\n--- 1. Generating Calibrated 6-Axis IMU Dataset ---")
    X, y = generate_imu_dataset(num_samples=3000, window_size=100)
    split = int(0.85 * len(X))
    X_train, X_val = X[:split], X[split:]
    y_train, y_val = y[:split], y[split:]
    print(f"Train Shape: {X_train.shape} | Val Shape: {X_val.shape}")

    print("\n--- 2. Building SafeCircle 1D-CNN Anomaly Detection Architecture ---")
    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(100, 6), name="imu_input"),
        tf.keras.layers.Conv1D(filters=32, kernel_size=3, padding='same', activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.MaxPooling1D(pool_size=2),
        tf.keras.layers.Conv1D(filters=64, kernel_size=3, padding='same', activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.GlobalAveragePooling1D(),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.Dropout(0.2),
        tf.keras.layers.Dense(2, activation='softmax', name="snatch_prob")
    ])

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='categorical_crossentropy',
        metrics=['accuracy']
    )
    model.summary()

    print("\n--- 3. Training Neural Anomaly Classifier ---")
    history = model.fit(
        X_train, y_train,
        validation_data=(X_val, y_val),
        epochs=15,
        batch_size=32,
        verbose=1
    )

    val_acc = history.history['val_accuracy'][-1]
    print(f"\nFinal Validation Accuracy: {val_acc * 100:.2f}%")

    print("\n--- 4. Quantizing to TensorFlow Lite (.tflite) ---")
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_quantized_model = converter.convert()

    # Destination paths
    assets_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/android/app/src/main/assets"))
    os.makedirs(assets_dir, exist_ok=True)

    tflite_path_assets = os.path.join(assets_dir, "theft_detection_model.tflite")
    tflite_path_local = os.path.join(os.path.dirname(__file__), "theft_detection_model.tflite")

    with open(tflite_path_assets, "wb") as f:
        f.write(tflite_quantized_model)
    with open(tflite_path_local, "wb") as f:
        f.write(tflite_quantized_model)

    model_size_kb = len(tflite_quantized_model) / 1024
    print(f"Quantized TFLite Model Size: {model_size_kb:.1f} KB")
    print(f"Saved to: {tflite_path_assets}")

    print("\n--- 5. Empirical Latency Profiling (100 Iterations) ---")
    interpreter = tf.lite.Interpreter(model_content=tflite_quantized_model)
    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    latencies = []
    # Warmup
    for _ in range(10):
        dummy_in = np.random.normal(0, 1.0, (1, 100, 6)).astype(np.float32)
        interpreter.set_tensor(input_details[0]['index'], dummy_in)
        interpreter.invoke()

    # Benchmarking
    for i in range(100):
        sample = X_val[i:i+1]
        start = time.perf_counter()
        interpreter.set_tensor(input_details[0]['index'], sample)
        interpreter.invoke()
        out = interpreter.get_tensor(output_details[0]['index'])
        latencies.append((time.perf_counter() - start) * 1000.0)

    avg_lat = np.mean(latencies)
    min_lat = np.min(latencies)
    max_lat = np.max(latencies)
    p50_lat = np.percentile(latencies, 50)
    p95_lat = np.percentile(latencies, 95)

    print(f"Empirical Inference Latency:")
    print(f"  Avg: {avg_lat:.2f} ms")
    print(f"  Min: {min_lat:.2f} ms")
    print(f"  Max: {max_lat:.2f} ms")
    print(f"  p50: {p50_lat:.2f} ms")
    print(f"  p95: {p95_lat:.2f} ms")

    if avg_lat < 15.0:
        print(f"✅ EXCEEDS TARGET: Latency {avg_lat:.2f} ms is well below 15.0 ms thesis threshold!")
    else:
        print(f"⚠️ Latency {avg_lat:.2f} ms exceeds 15.0 ms threshold.")

if __name__ == "__main__":
    main()
