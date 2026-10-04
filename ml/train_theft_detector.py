#!/usr/bin/env python3
"""
train_theft_detector.py

SafeCircle Real-Data 1D CNN Theft Detection Training Pipeline.
Trains on recorded 3-axis accelerometer CSVs (50 Hz) from participant P01,
exports an INT8-quantized TFLite model for on-device inference.

Usage:
    python3 ml/train_theft_detector.py --data-dir ~/safecircle_dataset/safecircle_imu/

Validation strategy:
    Clip-level grouped split (no temporal leakage between train/test).
    All windows from a given clip belong to exactly one split.
"""

import os
import sys
import glob
import time
import argparse
import json
import numpy as np

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

WINDOW_SIZE = 100       # 2.0 seconds at 50 Hz
STRIDE = 50            # 50% overlap → 1.0 second stride
CHANNELS = 3           # ax, ay, az only
TARGET_HZ = 50.0
SEED = 42
TEST_CLIP_FRACTION = 0.2  # ~20% of clips held out per class

# Training hyperparameters
EPOCHS = 80
BATCH_SIZE = 16
LEARNING_RATE = 1e-3
EARLY_STOP_PATIENCE = 15
LR_REDUCE_PATIENCE = 8
LR_REDUCE_FACTOR = 0.5
DROPOUT_RATE = 0.3

# Augmentation parameters
AUG_NOISE_STD = 0.05         # Gaussian noise σ (m/s²)
AUG_TIME_SHIFT_MAX = 5       # max frames to shift (±100ms)
AUG_SCALE_RANGE = (0.9, 1.1) # per-axis random scaling

# Label mapping
THEFT_LABELS = {'THEFT'}
NORMAL_LABELS = {'NORMAL', 'WALK', 'JOG', 'POCKET', 'SIT'}

np.random.seed(SEED)


# ---------------------------------------------------------------------------
# 1. Data Loading
# ---------------------------------------------------------------------------

def load_clips(data_dir: str) -> list[dict]:
    """
    Load all CSV clips from data_dir.
    Returns list of dicts: {filename, label, binary_label, data: ndarray(N,3)}
    """
    csv_files = sorted(glob.glob(os.path.join(data_dir, '*.csv')))
    if not csv_files:
        print(f"[ERROR] No CSV files found in {data_dir}")
        sys.exit(1)

    clips = []
    for fpath in csv_files:
        fname = os.path.basename(fpath)
        # Parse label from filename: P01_THEFT_1790695222682.csv
        parts = fname.split('_')
        if len(parts) < 3:
            print(f"  [SKIP] Cannot parse label from filename: {fname}")
            continue
        label = parts[1].upper()

        # Read CSV, skip header
        try:
            with open(fpath, 'r') as f:
                lines = [l.strip() for l in f if l.strip()]
            header = lines[0].lower().split(',')
            # Find ax, ay, az column indices
            ax_idx = header.index('ax')
            ay_idx = header.index('ay')
            az_idx = header.index('az')
        except (ValueError, IndexError) as e:
            print(f"  [SKIP] Failed to parse header in {fname}: {e}")
            continue

        rows = []
        for line in lines[1:]:
            cols = line.split(',')
            try:
                ax = float(cols[ax_idx])
                ay = float(cols[ay_idx])
                az = float(cols[az_idx])
                rows.append([ax, ay, az])
            except (ValueError, IndexError):
                continue

        if len(rows) < WINDOW_SIZE:
            print(f"  [SKIP] {fname}: only {len(rows)} frames (need >= {WINDOW_SIZE})")
            continue

        data = np.array(rows, dtype=np.float32)

        if label in THEFT_LABELS:
            binary_label = 1
        elif label in NORMAL_LABELS:
            binary_label = 0
        else:
            print(f"  [SKIP] Unknown label '{label}' in {fname}")
            continue

        clips.append({
            'filename': fname,
            'label': label,
            'binary_label': binary_label,
            'data': data,
        })

    return clips


# ---------------------------------------------------------------------------
# 2. Windowing
# ---------------------------------------------------------------------------

def extract_windows(clips: list[dict]) -> tuple:
    """
    Slice each clip into overlapping windows.
    Returns (windows: ndarray, labels: ndarray, clip_indices: list[int])
    where clip_indices[i] = index of the source clip for window i.
    """
    all_windows = []
    all_labels = []
    all_clip_idx = []

    for ci, clip in enumerate(clips):
        data = clip['data']
        n_frames = len(data)
        start = 0
        while start + WINDOW_SIZE <= n_frames:
            window = data[start:start + WINDOW_SIZE]  # (100, 3)
            all_windows.append(window)
            all_labels.append(clip['binary_label'])
            all_clip_idx.append(ci)
            start += STRIDE

    X = np.array(all_windows, dtype=np.float32)
    y = np.array(all_labels, dtype=np.float32)
    return X, y, all_clip_idx


# ---------------------------------------------------------------------------
# 3. Clip-Level Grouped Train/Test Split
# ---------------------------------------------------------------------------

def grouped_clip_split(clips: list[dict], test_fraction: float = 0.2, seed: int = 42):
    """
    Split clips into train/test sets at the clip level (no leakage).
    Stratified by binary_label.
    Returns (train_clip_indices, test_clip_indices).
    """
    rng = np.random.RandomState(seed)

    theft_indices = [i for i, c in enumerate(clips) if c['binary_label'] == 1]
    normal_indices = [i for i, c in enumerate(clips) if c['binary_label'] == 0]

    rng.shuffle(theft_indices)
    rng.shuffle(normal_indices)

    n_theft_test = max(1, int(len(theft_indices) * test_fraction))
    n_normal_test = max(1, int(len(normal_indices) * test_fraction))

    test_indices = theft_indices[:n_theft_test] + normal_indices[:n_normal_test]
    train_indices = theft_indices[n_theft_test:] + normal_indices[n_normal_test:]

    return sorted(train_indices), sorted(test_indices)


def split_windows_by_clips(X, y, clip_indices, train_clip_idx, test_clip_idx):
    """
    Partition windows into train/test based on which clip they came from.
    """
    train_set = set(train_clip_idx)
    test_set = set(test_clip_idx)

    train_mask = np.array([ci in train_set for ci in clip_indices])
    test_mask = np.array([ci in test_set for ci in clip_indices])

    return X[train_mask], y[train_mask], X[test_mask], y[test_mask]


# ---------------------------------------------------------------------------
# 4. Normalization
# ---------------------------------------------------------------------------

def compute_normalization(X_train):
    """Compute per-axis mean and std from training data."""
    # X_train shape: (N, 100, 3)
    mean = X_train.reshape(-1, CHANNELS).mean(axis=0)
    std = X_train.reshape(-1, CHANNELS).std(axis=0)
    std = np.where(std < 1e-6, 1.0, std)  # avoid division by zero
    return mean, std


def apply_normalization(X, mean, std):
    """Apply z-score normalization."""
    return (X - mean) / std


# ---------------------------------------------------------------------------
# 5. Data Augmentation
# ---------------------------------------------------------------------------

class AugmentedDataGenerator:
    """
    On-the-fly augmentation generator for training.
    Applies: Gaussian noise, random temporal shift, random axis scaling.
    """
    def __init__(self, X, y, batch_size, mean, std):
        self.X_raw = X  # un-normalized
        self.y = y
        self.batch_size = batch_size
        self.mean = mean
        self.std = std
        self.n = len(X)
        self.indices = np.arange(self.n)

    def __len__(self):
        return int(np.ceil(self.n / self.batch_size))

    def on_epoch_end(self):
        np.random.shuffle(self.indices)

    def __getitem__(self, idx):
        batch_idx = self.indices[idx * self.batch_size:(idx + 1) * self.batch_size]
        X_batch = self.X_raw[batch_idx].copy()
        y_batch = self.y[batch_idx]

        for i in range(len(X_batch)):
            # 1. Additive Gaussian noise
            X_batch[i] += np.random.normal(0, AUG_NOISE_STD, X_batch[i].shape).astype(np.float32)

            # 2. Random temporal shift (circular shift along time axis)
            shift = np.random.randint(-AUG_TIME_SHIFT_MAX, AUG_TIME_SHIFT_MAX + 1)
            if shift != 0:
                X_batch[i] = np.roll(X_batch[i], shift, axis=0)

            # 3. Random per-axis scaling
            scale = np.random.uniform(AUG_SCALE_RANGE[0], AUG_SCALE_RANGE[1], size=(1, CHANNELS)).astype(np.float32)
            X_batch[i] *= scale

        # Normalize after augmentation
        X_batch = (X_batch - self.mean) / self.std
        return X_batch, y_batch


# ---------------------------------------------------------------------------
# 6. Model Architecture
# ---------------------------------------------------------------------------

def build_model():
    """Build the 1D CNN theft detector."""
    import tensorflow as tf

    model = tf.keras.Sequential([
        tf.keras.layers.Input(shape=(WINDOW_SIZE, CHANNELS), name='accel_input'),

        # Block 1
        tf.keras.layers.Conv1D(32, kernel_size=5, padding='same', activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.MaxPooling1D(pool_size=2),

        # Block 2
        tf.keras.layers.Conv1D(64, kernel_size=5, padding='same', activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.MaxPooling1D(pool_size=2),

        # Block 3
        tf.keras.layers.Conv1D(64, kernel_size=3, padding='same', activation='relu'),
        tf.keras.layers.BatchNormalization(),
        tf.keras.layers.GlobalAveragePooling1D(),

        # Classifier head
        tf.keras.layers.Dropout(DROPOUT_RATE),
        tf.keras.layers.Dense(32, activation='relu'),
        tf.keras.layers.Dropout(DROPOUT_RATE),
        tf.keras.layers.Dense(1, activation='sigmoid', name='theft_prob'),
    ])

    return model


# ---------------------------------------------------------------------------
# 7. Evaluation Metrics
# ---------------------------------------------------------------------------

def evaluate_model(model, X_test, y_test):
    """
    Compute full classification report: accuracy, precision, recall, F1, FPR,
    and confusion matrix.
    """
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
        confusion_matrix, classification_report
    )

    y_prob = model.predict(X_test, verbose=0).flatten()
    y_pred = (y_prob >= 0.5).astype(int)
    y_true = y_test.astype(int)

    acc = accuracy_score(y_true, y_pred)
    prec = precision_score(y_true, y_pred, zero_division=0)
    rec = recall_score(y_true, y_pred, zero_division=0)
    f1 = f1_score(y_true, y_pred, zero_division=0)

    cm = confusion_matrix(y_true, y_pred)
    tn, fp, fn, tp = cm.ravel()
    fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0

    report_str = classification_report(y_true, y_pred, target_names=['NORMAL', 'THEFT'], zero_division=0)

    metrics = {
        'accuracy': float(acc),
        'precision': float(prec),
        'recall': float(rec),
        'f1_score': float(f1),
        'false_positive_rate': float(fpr),
        'true_positives': int(tp),
        'false_positives': int(fp),
        'true_negatives': int(tn),
        'false_negatives': int(fn),
        'confusion_matrix': cm.tolist(),
        'classification_report': report_str,
    }

    return metrics, y_prob


# ---------------------------------------------------------------------------
# 8. Training Curve Plotting
# ---------------------------------------------------------------------------

def plot_training_curves(history, output_path):
    """Save training/validation loss and accuracy curves."""
    import matplotlib
    matplotlib.use('Agg')  # non-interactive backend
    import matplotlib.pyplot as plt

    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 5))

    # Loss
    ax1.plot(history.history['loss'], label='Train Loss', linewidth=2)
    ax1.plot(history.history['val_loss'], label='Val Loss', linewidth=2)
    ax1.set_xlabel('Epoch')
    ax1.set_ylabel('Binary Cross-Entropy Loss')
    ax1.set_title('Training & Validation Loss')
    ax1.legend()
    ax1.grid(True, alpha=0.3)

    # Accuracy
    ax2.plot(history.history['accuracy'], label='Train Accuracy', linewidth=2)
    ax2.plot(history.history['val_accuracy'], label='Val Accuracy', linewidth=2)
    ax2.set_xlabel('Epoch')
    ax2.set_ylabel('Accuracy')
    ax2.set_title('Training & Validation Accuracy')
    ax2.legend()
    ax2.grid(True, alpha=0.3)

    plt.tight_layout()
    plt.savefig(output_path, dpi=150)
    plt.close()
    print(f"[✔] Training curves saved to {output_path}")


# ---------------------------------------------------------------------------
# 9. TFLite Export with INT8 Quantization
# ---------------------------------------------------------------------------

def export_tflite(model, X_train, output_dir):
    """Export model to INT8-quantized TFLite format."""
    import tensorflow as tf

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]

    # Full INT8 quantization with representative dataset
    def representative_dataset_gen():
        # Use up to 200 training samples for calibration
        indices = np.random.choice(len(X_train), min(200, len(X_train)), replace=False)
        for i in indices:
            yield [X_train[i:i+1].astype(np.float32)]

    converter.representative_dataset = representative_dataset_gen
    converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
    converter.inference_input_type = tf.int8
    converter.inference_output_type = tf.float32

    tflite_model = converter.convert()

    # Save to ml/ directory
    local_path = os.path.join(output_dir, 'theft_detector.tflite')
    with open(local_path, 'wb') as f:
        f.write(tflite_model)

    # Save to Android assets for APK bundling
    assets_dir = os.path.abspath(os.path.join(output_dir, '../frontend/android/app/src/main/assets'))
    os.makedirs(assets_dir, exist_ok=True)
    assets_path = os.path.join(assets_dir, 'theft_detector.tflite')
    with open(assets_path, 'wb') as f:
        f.write(tflite_model)

    model_size_kb = len(tflite_model) / 1024.0
    print(f"[✔] TFLite model size: {model_size_kb:.1f} KB")
    print(f"[✔] Saved to: {local_path}")
    print(f"[✔] Copied to: {assets_path}")

    return tflite_model, local_path


# ---------------------------------------------------------------------------
# 10. Latency Benchmark
# ---------------------------------------------------------------------------

def benchmark_tflite(tflite_model_bytes, X_test, n_warmup=20, n_iter=100):
    """Run inference latency benchmark on host CPU."""
    import tensorflow as tf

    interpreter = tf.lite.Interpreter(model_content=tflite_model_bytes)
    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()
    input_dtype = input_details[0]['dtype']
    input_scale = input_details[0].get('quantization_parameters', {}).get('scales', [1.0])
    input_zp = input_details[0].get('quantization_parameters', {}).get('zero_points', [0])

    def prepare_input(sample):
        """Quantize float32 input to int8 if model expects it."""
        if input_dtype == np.int8:
            if len(input_scale) > 0 and input_scale[0] != 0:
                quantized = (sample / input_scale[0]) + input_zp[0]
                return np.clip(quantized, -128, 127).astype(np.int8)
        return sample.astype(np.float32)

    # Warmup
    for _ in range(n_warmup):
        inp = prepare_input(X_test[0:1])
        interpreter.set_tensor(input_details[0]['index'], inp)
        interpreter.invoke()

    # Benchmark
    latencies = []
    n_samples = min(n_iter, len(X_test))
    for i in range(n_samples):
        inp = prepare_input(X_test[i:i+1])
        t0 = time.perf_counter()
        interpreter.set_tensor(input_details[0]['index'], inp)
        interpreter.invoke()
        _ = interpreter.get_tensor(output_details[0]['index'])
        latencies.append((time.perf_counter() - t0) * 1000.0)

    latencies = np.array(latencies)
    return {
        'avg_ms': float(np.mean(latencies)),
        'min_ms': float(np.min(latencies)),
        'max_ms': float(np.max(latencies)),
        'p50_ms': float(np.percentile(latencies, 50)),
        'p95_ms': float(np.percentile(latencies, 95)),
        'n_iterations': n_samples,
    }


# ===========================================================================
# Main
# ===========================================================================

def main():
    parser = argparse.ArgumentParser(description='Train SafeCircle theft detector on real IMU data.')
    parser.add_argument('--data-dir', type=str,
                        default=os.path.expanduser('~/safecircle_dataset/safecircle_imu/'),
                        help='Directory containing raw IMU CSV clips')
    parser.add_argument('--output-dir', type=str,
                        default=os.path.dirname(os.path.abspath(__file__)),
                        help='Directory to save model and artifacts (default: ml/)')
    parser.add_argument('--seed', type=int, default=SEED)
    args = parser.parse_args()

    np.random.seed(args.seed)

    import tensorflow as tf
    tf.random.set_seed(args.seed)
    print(f"TensorFlow {tf.__version__}")
    print(f"NumPy {np.__version__}")
    print(f"Seed: {args.seed}")

    # ── Step 1: Load clips ──────────────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 1: Loading Clips")
    print("="*70)

    clips = load_clips(args.data_dir)
    n_theft = sum(1 for c in clips if c['binary_label'] == 1)
    n_normal = sum(1 for c in clips if c['binary_label'] == 0)
    print(f"Loaded {len(clips)} clips: {n_theft} THEFT, {n_normal} NORMAL")
    for c in clips:
        print(f"  {c['filename']:45s}  {c['label']:8s}  {len(c['data']):4d} frames  ({len(c['data'])*0.02:.1f}s)")

    # ── Step 2: Clip-level grouped split ────────────────────────────────
    print("\n" + "="*70)
    print("STEP 2: Clip-Level Grouped Train/Test Split")
    print("="*70)

    train_clip_idx, test_clip_idx = grouped_clip_split(clips, TEST_CLIP_FRACTION, args.seed)

    print(f"Train clips ({len(train_clip_idx)}):")
    for i in train_clip_idx:
        print(f"  [{i:2d}] {clips[i]['filename']:45s}  {clips[i]['label']}")
    print(f"Test clips ({len(test_clip_idx)}):")
    for i in test_clip_idx:
        print(f"  [{i:2d}] {clips[i]['filename']:45s}  {clips[i]['label']}")

    train_theft = sum(1 for i in train_clip_idx if clips[i]['binary_label'] == 1)
    train_normal = sum(1 for i in train_clip_idx if clips[i]['binary_label'] == 0)
    test_theft = sum(1 for i in test_clip_idx if clips[i]['binary_label'] == 1)
    test_normal = sum(1 for i in test_clip_idx if clips[i]['binary_label'] == 0)
    print(f"\nTrain: {train_theft} THEFT + {train_normal} NORMAL = {len(train_clip_idx)} clips")
    print(f"Test:  {test_theft} THEFT + {test_normal} NORMAL = {len(test_clip_idx)} clips")

    # ── Step 3: Extract windows ─────────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 3: Extracting 2-Second Windows (50% Overlap)")
    print("="*70)

    X_all, y_all, clip_indices = extract_windows(clips)
    X_train, y_train, X_test, y_test = split_windows_by_clips(
        X_all, y_all, clip_indices, train_clip_idx, test_clip_idx
    )

    print(f"Total windows: {len(X_all)}  (shape: {X_all.shape})")
    print(f"Train windows: {len(X_train)}  (THEFT: {int(y_train.sum())}, NORMAL: {int(len(y_train) - y_train.sum())})")
    print(f"Test windows:  {len(X_test)}   (THEFT: {int(y_test.sum())}, NORMAL: {int(len(y_test) - y_test.sum())})")

    # ── Step 4: Normalization ───────────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 4: Computing Normalization (from training set only)")
    print("="*70)

    mean, std = compute_normalization(X_train)
    print(f"Per-axis mean: ax={mean[0]:.4f}, ay={mean[1]:.4f}, az={mean[2]:.4f}")
    print(f"Per-axis std:  ax={std[0]:.4f},  ay={std[1]:.4f},  az={std[2]:.4f}")

    # Save normalization constants for Android inference code
    norm_constants = {
        'mean': mean.tolist(),
        'std': std.tolist(),
        'channels': ['ax', 'ay', 'az'],
        'window_size': WINDOW_SIZE,
        'target_hz': TARGET_HZ,
    }
    norm_path = os.path.join(args.output_dir, 'normalization_constants.json')
    with open(norm_path, 'w') as f:
        json.dump(norm_constants, f, indent=2)
    print(f"[✔] Normalization constants saved to {norm_path}")

    # Normalize test set (train set is normalized on-the-fly in augmented generator)
    X_test_norm = apply_normalization(X_test, mean, std)

    # ── Step 5: Compute class weights ───────────────────────────────────
    n_pos = int(y_train.sum())
    n_neg = int(len(y_train) - y_train.sum())
    total = n_pos + n_neg
    class_weight = {
        0: total / (2.0 * n_neg),
        1: total / (2.0 * n_pos),
    }
    print(f"\nClass weights: NORMAL={class_weight[0]:.3f}, THEFT={class_weight[1]:.3f}")

    # ── Step 6: Build model ─────────────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 5: Building 1D CNN Architecture")
    print("="*70)

    model = build_model()
    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=LEARNING_RATE),
        loss='binary_crossentropy',
        metrics=['accuracy'],
    )
    model.summary()

    # ── Step 7: Train ───────────────────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 6: Training with Augmentation")
    print("="*70)

    # Create augmented training data generator
    aug_gen = AugmentedDataGenerator(X_train, y_train, BATCH_SIZE, mean, std)

    # For tf.keras.Model.fit we need a tf.data.Dataset or use manual training.
    # Simpler approach: pre-augment each epoch in a custom callback.
    # Even simpler: augment the full training set N times and train on that.
    # Best approach for this small dataset: augment on-the-fly with a manual loop,
    # or just use the Keras fit with noise added via a custom Keras layer.
    #
    # For clarity and reproducibility, we'll augment the training data and
    # re-augment fresh each time by using a tf.data.Dataset with a map function.

    def augment_sample(x, y_label):
        """TF-native augmentation ops."""
        # Gaussian noise
        noise = tf.random.normal(shape=tf.shape(x), mean=0.0, stddev=AUG_NOISE_STD)
        x = x + noise

        # Random temporal shift via tf.roll
        shift = tf.random.uniform([], -AUG_TIME_SHIFT_MAX, AUG_TIME_SHIFT_MAX + 1, dtype=tf.int32)
        x = tf.roll(x, shift=shift, axis=0)

        # Random per-axis scaling
        scale = tf.random.uniform([1, CHANNELS], AUG_SCALE_RANGE[0], AUG_SCALE_RANGE[1])
        x = x * scale

        # Normalize
        x = (x - mean) / std

        return x, y_label

    def normalize_only(x, y_label):
        x = (x - mean) / std
        return x, y_label

    train_ds = tf.data.Dataset.from_tensor_slices((X_train, y_train))
    train_ds = train_ds.shuffle(len(X_train), seed=args.seed, reshuffle_each_iteration=True)
    train_ds = train_ds.map(augment_sample, num_parallel_calls=tf.data.AUTOTUNE)
    train_ds = train_ds.batch(BATCH_SIZE)
    train_ds = train_ds.prefetch(tf.data.AUTOTUNE)

    val_ds = tf.data.Dataset.from_tensor_slices((X_test, y_test))
    val_ds = val_ds.map(normalize_only, num_parallel_calls=tf.data.AUTOTUNE)
    val_ds = val_ds.batch(BATCH_SIZE)
    val_ds = val_ds.prefetch(tf.data.AUTOTUNE)

    callbacks = [
        tf.keras.callbacks.EarlyStopping(
            monitor='val_loss',
            patience=EARLY_STOP_PATIENCE,
            restore_best_weights=True,
            verbose=1,
        ),
        tf.keras.callbacks.ReduceLROnPlateau(
            monitor='val_loss',
            factor=LR_REDUCE_FACTOR,
            patience=LR_REDUCE_PATIENCE,
            min_lr=1e-6,
            verbose=1,
        ),
    ]

    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=EPOCHS,
        class_weight=class_weight,
        callbacks=callbacks,
        verbose=1,
    )

    # ── Step 8: Evaluate ────────────────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 7: Evaluation on Held-Out Test Clips")
    print("="*70)

    metrics, y_prob = evaluate_model(model, X_test_norm, y_test)

    print(f"\n  Accuracy:            {metrics['accuracy']:.4f}  ({metrics['accuracy']*100:.1f}%)")
    print(f"  Precision:           {metrics['precision']:.4f}")
    print(f"  Recall (TPR):        {metrics['recall']:.4f}")
    print(f"  F1 Score:            {metrics['f1_score']:.4f}")
    print(f"  False Alarm Rate:    {metrics['false_positive_rate']:.4f}  ({metrics['false_positive_rate']*100:.1f}%)")
    print(f"\n  Confusion Matrix:")
    print(f"                    Predicted")
    print(f"                  NORMAL  THEFT")
    print(f"  Actual NORMAL    {metrics['true_negatives']:5d}  {metrics['false_positives']:5d}")
    print(f"  Actual THEFT     {metrics['false_negatives']:5d}  {metrics['true_positives']:5d}")
    print(f"\n{metrics['classification_report']}")

    # ── Step 9: Plot training curves ────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 8: Saving Training Curves")
    print("="*70)

    curves_path = os.path.join(args.output_dir, 'training_curves.png')
    plot_training_curves(history, curves_path)

    # ── Step 10: Export TFLite ──────────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 9: Exporting INT8-Quantized TFLite Model")
    print("="*70)

    tflite_bytes, tflite_path = export_tflite(model, X_train, args.output_dir)

    # ── Step 11: Latency benchmark ──────────────────────────────────────
    print("\n" + "="*70)
    print("STEP 10: Inference Latency Benchmark (Host CPU)")
    print("="*70)

    latency = benchmark_tflite(tflite_bytes, X_test_norm)
    print(f"  Avg: {latency['avg_ms']:.2f} ms")
    print(f"  Min: {latency['min_ms']:.2f} ms")
    print(f"  Max: {latency['max_ms']:.2f} ms")
    print(f"  P50: {latency['p50_ms']:.2f} ms")
    print(f"  P95: {latency['p95_ms']:.2f} ms")

    if latency['avg_ms'] < 15.0:
        print(f"  ✅ Within 15 ms thesis target")
    else:
        print(f"  ⚠️  Exceeds 15 ms thesis target")

    # ── Step 12: Save full report ───────────────────────────────────────
    report = {
        'dataset': {
            'data_dir': args.data_dir,
            'total_clips': len(clips),
            'theft_clips': n_theft,
            'normal_clips': n_normal,
            'train_clips': len(train_clip_idx),
            'test_clips': len(test_clip_idx),
            'window_size': WINDOW_SIZE,
            'stride': STRIDE,
            'channels': CHANNELS,
            'target_hz': TARGET_HZ,
            'total_windows': len(X_all),
            'train_windows': len(X_train),
            'test_windows': len(X_test),
        },
        'normalization': norm_constants,
        'architecture': {
            'type': '1D CNN',
            'input_shape': [WINDOW_SIZE, CHANNELS],
            'total_params': int(model.count_params()),
        },
        'training': {
            'epochs_run': len(history.history['loss']),
            'max_epochs': EPOCHS,
            'batch_size': BATCH_SIZE,
            'learning_rate': LEARNING_RATE,
            'class_weights': class_weight,
            'augmentation': {
                'noise_std': AUG_NOISE_STD,
                'time_shift_max_frames': AUG_TIME_SHIFT_MAX,
                'scale_range': list(AUG_SCALE_RANGE),
            },
            'final_train_loss': float(history.history['loss'][-1]),
            'final_val_loss': float(history.history['val_loss'][-1]),
            'final_train_acc': float(history.history['accuracy'][-1]),
            'final_val_acc': float(history.history['val_accuracy'][-1]),
        },
        'evaluation': metrics,
        'tflite': {
            'path': tflite_path,
            'size_kb': len(tflite_bytes) / 1024.0,
            'quantization': 'INT8 (full integer)',
            'input_type': 'int8',
            'output_type': 'float32',
        },
        'latency': latency,
        'validation_strategy': 'Clip-level grouped split (no temporal leakage). '
                               'All windows from a clip belong to exactly one split.',
        'limitation': 'Single-participant (P01), single-device (Samsung Galaxy A05). '
                      'Intra-participant discriminability only. '
                      'Cross-participant generalization requires LOSO cross-validation '
                      'with additional participants (identified as future work).',
        'seed': args.seed,
    }

    report_path = os.path.join(args.output_dir, 'training_report.json')
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)
    print(f"\n[✔] Full training report saved to {report_path}")

    # Also save a human-readable text summary
    txt_path = os.path.join(args.output_dir, 'training_report.txt')
    with open(txt_path, 'w') as f:
        f.write("SafeCircle Theft Detector — Training Report\n")
        f.write("=" * 60 + "\n\n")
        f.write(f"Date: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write(f"Seed: {args.seed}\n\n")
        f.write(f"Dataset: {len(clips)} clips ({n_theft} THEFT, {n_normal} NORMAL)\n")
        f.write(f"Train: {len(train_clip_idx)} clips → {len(X_train)} windows\n")
        f.write(f"Test:  {len(test_clip_idx)} clips → {len(X_test)} windows\n")
        f.write(f"Validation: Clip-level grouped split (no leakage)\n\n")
        f.write(f"Model: 1D CNN, {model.count_params()} params\n")
        f.write(f"Input: ({WINDOW_SIZE}, {CHANNELS}) = 2s × [ax, ay, az]\n\n")
        f.write(f"Epochs trained: {len(history.history['loss'])}/{EPOCHS}\n")
        f.write(f"Final train acc: {history.history['accuracy'][-1]:.4f}\n")
        f.write(f"Final val acc:   {history.history['val_accuracy'][-1]:.4f}\n\n")
        f.write(f"--- Test Set Metrics ---\n")
        f.write(f"Accuracy:         {metrics['accuracy']:.4f}\n")
        f.write(f"Precision:        {metrics['precision']:.4f}\n")
        f.write(f"Recall (TPR):     {metrics['recall']:.4f}\n")
        f.write(f"F1 Score:         {metrics['f1_score']:.4f}\n")
        f.write(f"False Alarm Rate: {metrics['false_positive_rate']:.4f}\n\n")
        f.write(f"Confusion Matrix:\n")
        f.write(f"                Predicted\n")
        f.write(f"              NORMAL  THEFT\n")
        f.write(f"Actual NORMAL  {metrics['true_negatives']:5d}  {metrics['false_positives']:5d}\n")
        f.write(f"Actual THEFT   {metrics['false_negatives']:5d}  {metrics['true_positives']:5d}\n\n")
        f.write(f"{metrics['classification_report']}\n")
        f.write(f"TFLite model: {len(tflite_bytes)/1024:.1f} KB (INT8 quantized)\n")
        f.write(f"Avg latency:  {latency['avg_ms']:.2f} ms (host CPU)\n\n")
        f.write(f"LIMITATION: Single-participant (P01), single-device (Galaxy A05).\n")
        f.write(f"Reported metrics reflect intra-participant discriminability only.\n")
        f.write(f"Cross-participant generalization requires LOSO cross-validation.\n")
    print(f"[✔] Human-readable report saved to {txt_path}")

    print("\n" + "="*70)
    print("DONE — All artifacts saved.")
    print("="*70)


if __name__ == '__main__':
    main()
