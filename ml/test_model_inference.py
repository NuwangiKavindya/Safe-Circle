#!/usr/bin/env python3
"""
SafeCircle Stage 2 TFLite Automated Test & Benchmarking Suite
Validates the on-device quantized model deployed to Android assets:
1. Validates FlatBuffer binary schema and integrity
2. Verifies tensor shapes: Input [1, 100, 6] -> Output [1, 2]
3. Tests binary classification on Benign vs Theft Snatch gestures
4. Profiles empirical latency across 100 iterations to verify <15ms constraint
"""

import os
import sys
import time
import numpy as np

def run_tflite_test_suite():
    print("====================================================")
    print("🚀 RUNNING STEP 2: STAGE 2 TFLITE VALIDATION SUITE")
    print("====================================================\n")

    passed = 0
    failed = 0

    def assert_test(cond, desc):
        nonlocal passed, failed
        if cond:
            print(f"✅ [PASS] {desc}")
            passed += 1
        else:
            print(f"❌ [FAIL] {desc}")
            failed += 1

    # 1. Verify model file exists in Android assets
    model_path = os.path.abspath(os.path.join(
        os.path.dirname(__file__),
        "../frontend/android/app/src/main/assets/theft_detection_model.tflite"
    ))

    assert_test(os.path.exists(model_path), f"TFLite model exists in Android assets ({model_path})")

    file_size_bytes = os.path.getsize(model_path)
    file_size_kb = file_size_bytes / 1024.0
    print(f"Model File Size: {file_size_kb:.2f} KB ({file_size_bytes} bytes)")
    assert_test(file_size_kb < 100.0, f"Quantized model is ultra-compact ({file_size_kb:.2f} KB < 100 KB)")

    # 2. Check FlatBuffer identifier 'TFL3'
    with open(model_path, "rb") as f:
        header = f.read(8)
        is_tfl3 = header[4:8] == b"TFL3"
    assert_test(is_tfl3, "Model contains valid FlatBuffer TFL3 magic header identifier")

    # 3. Load with TensorFlow Lite Interpreter
    import tensorflow as tf
    try:
        interpreter = tf.lite.Interpreter(model_path=model_path)
        interpreter.allocate_tensors()
        assert_test(True, "TensorFlow Lite interpreter allocated tensors successfully")
    except Exception as e:
        assert_test(False, f"Interpreter allocation failed: {e}")
        return 1

    # 4. Check Input / Output Tensor Specifications
    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    input_shape = list(input_details[0]['shape'])
    output_shape = list(output_details[0]['shape'])

    print(f"Input Tensor Shape : {input_shape} (Type: {input_details[0]['dtype']})")
    print(f"Output Tensor Shape: {output_shape} (Type: {output_details[0]['dtype']})")

    assert_test(input_shape == [1, 100, 6], "Input tensor matches expected shape [1, 100, 6] (100 samples x 6 IMU axes)")
    assert_test(output_shape == [1, 2], "Output tensor matches expected shape [1, 2] (Softmax probabilities)")

    # 5. Test Case A: Benign Desk Resting (Gravity on Z, zero gyro, no snatch)
    desk_sample = np.zeros((1, 100, 6), dtype=np.float32)
    desk_sample[0, :, 2] = 9.81 + np.random.normal(0, 0.05, 100) # Pure gravity
    interpreter.set_tensor(input_details[0]['index'], desk_sample)
    interpreter.invoke()
    desk_out = interpreter.get_tensor(output_details[0]['index'])[0]
    print(f"Desk Resting Output: Benign={desk_out[0]:.4f}, Snatch={desk_out[1]:.4f}")
    assert_test(desk_out[0] > 0.90, "Desk resting correctly classified as BENIGN (Prob > 90%)")
    assert_test(desk_out[1] < 0.10, "Desk resting theft probability is near zero (< 10%)")

    # 6. Test Case B: Benign Walking (1.8 Hz footfalls, smooth motion)
    walk_sample = np.zeros((1, 100, 6), dtype=np.float32)
    t = np.linspace(0, 2.0, 100)
    walk_sample[0, :, 0] = 0.8 * np.sin(2 * np.pi * 1.8 * t)
    walk_sample[0, :, 1] = 9.81 + 1.2 * np.cos(2 * np.pi * 1.8 * t)
    walk_sample[0, :, 2] = 0.5 * np.sin(2 * np.pi * 1.8 * t)
    interpreter.set_tensor(input_details[0]['index'], walk_sample)
    interpreter.invoke()
    walk_out = interpreter.get_tensor(output_details[0]['index'])[0]
    print(f"Normal Walking Output: Benign={walk_out[0]:.4f}, Snatch={walk_out[1]:.4f}")
    assert_test(walk_out[0] > 0.85, "Normal walking correctly classified as BENIGN (Prob > 85%)")

    # 7. Test Case C: Violent Snatch Anomaly (Sudden massive jerk grab + flip)
    sys.path.append(os.path.dirname(__file__))
    from train_export_tflite import generate_imu_dataset
    test_X, test_y = generate_imu_dataset(num_samples=100, window_size=100)
    snatch_idx = next(i for i in range(100) if test_y[i, 1] == 1.0)
    snatch_sample = test_X[snatch_idx:snatch_idx + 1]

    interpreter.set_tensor(input_details[0]['index'], snatch_sample)
    interpreter.invoke()
    snatch_out = interpreter.get_tensor(output_details[0]['index'])[0]
    print(f"Violent Snatch Output: Benign={snatch_out[0]:.4f}, Snatch={snatch_out[1]:.4f}")
    assert_test(snatch_out[1] > 0.85, "Violent snatch correctly flagged as THEFT ANOMALY (Prob > 85%)")

    # 8. Empirical Latency Benchmarking (100 Iterations)
    print("\n--- Latency Benchmarking ---")
    latencies = []
    # Warmup
    for _ in range(10):
        interpreter.set_tensor(input_details[0]['index'], snatch_sample)
        interpreter.invoke()

    for _ in range(100):
        t0 = time.perf_counter()
        interpreter.set_tensor(input_details[0]['index'], snatch_sample)
        interpreter.invoke()
        _ = interpreter.get_tensor(output_details[0]['index'])
        latencies.append((time.perf_counter() - t0) * 1000.0)

    mean_lat = float(np.mean(latencies))
    min_lat = float(np.min(latencies))
    max_lat = float(np.max(latencies))
    p50_lat = float(np.percentile(latencies, 50))
    p95_lat = float(np.percentile(latencies, 95))

    print(f"Mean Latency : {mean_lat:.3f} ms")
    print(f"Min Latency  : {min_lat:.3f} ms")
    print(f"Max Latency  : {max_lat:.3f} ms")
    print(f"p50 Latency  : {p50_lat:.3f} ms")
    print(f"p95 Latency  : {p95_lat:.3f} ms")

    assert_test(mean_lat < 15.0, f"Mean latency ({mean_lat:.3f} ms) satisfies thesis target (< 15.0 ms)")
    assert_test(p95_lat < 15.0, f"p95 latency ({p95_lat:.3f} ms) satisfies 95th percentile target (< 15.0 ms)")

    print("\n====================================================")
    print(f"TEST SUMMARY: {passed} PASSED, {failed} FAILED")
    print("====================================================")
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(run_tflite_test_suite())
