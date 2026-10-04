#!/usr/bin/env python3
"""
resample_dataset.py

Offline 50 Hz Linear Resampling Script for SafeCircle IMU Time-Series.
Interpolates non-uniform raw sensor logs onto a strictly uniform temporal grid
with exact 20.0 ms intervals (50 Hz), resolving jitter and duplicate timestamps.

Usage:
  # Single CSV:
  python3 ml/resample_dataset.py -i ~/safecircle_dataset/P01_THEFT_raw.csv -o ~/safecircle_dataset/P01_THEFT_50hz.csv

  # Entire Directory:
  python3 ml/resample_dataset.py -d ~/safecircle_dataset/ --output-dir ~/safecircle_dataset_50hz/

  # Drop Gyroscope (produce 3-channel [ax, ay, az] dataset for Galaxy A05 / budget phones):
  python3 ml/resample_dataset.py -d ~/safecircle_dataset/ --output-dir ~/safecircle_dataset_3ch/ --channels 3
"""

import os
import sys
import glob
import argparse
import numpy as np

def resample_single_file(input_path: str, output_path: str, target_hz: float = 50.0, channels: int = 6) -> dict:
    """
    Reads a raw IMU CSV file and resamples it to a uniform time grid using 1D linear interpolation.
    """
    if not os.path.exists(input_path):
        raise FileNotFoundError(f"Input file not found: {input_path}")

    # Read rows
    with open(input_path, 'r', encoding='utf-8') as f:
        lines = [line.strip() for line in f if line.strip()]

    if len(lines) < 3:
        raise ValueError(f"File {input_path} has fewer than 2 data rows, skipping.")

    header = [h.strip() for h in lines[0].split(',')]
    data_rows = [line.split(',') for line in lines[1:]]

    # Map headers to indices
    header_lower = [h.lower() for h in header]
    try:
        t_idx = header_lower.index('timestamp_ms')
    except ValueError:
        t_idx = 0  # fallback to first column

    try:
        ax_idx = header_lower.index('ax')
        ay_idx = header_lower.index('ay')
        az_idx = header_lower.index('az')
    except ValueError:
        ax_idx, ay_idx, az_idx = 1, 2, 3

    # Check for gyro columns
    has_gyro = 'gx' in header_lower and 'gy' in header_lower and 'gz' in header_lower
    if has_gyro:
        gx_idx = header_lower.index('gx')
        gy_idx = header_lower.index('gy')
        gz_idx = header_lower.index('gz')
    else:
        gx_idx, gy_idx, gz_idx = -1, -1, -1

    label_idx = header_lower.index('label') if 'label' in header_lower else 7
    pid_idx = header_lower.index('participant_id') if 'participant_id' in header_lower else 8

    # Parse numeric data
    parsed_samples = []
    metadata_label = "UNKNOWN"
    metadata_pid = "P00"

    for row in data_rows:
        try:
            t = float(row[t_idx])
            ax = float(row[ax_idx])
            ay = float(row[ay_idx])
            az = float(row[az_idx])
            gx = float(row[gx_idx]) if has_gyro and gx_idx < len(row) else 0.0
            gy = float(row[gy_idx]) if has_gyro and gy_idx < len(row) else 0.0
            gz = float(row[gz_idx]) if has_gyro and gz_idx < len(row) else 0.0

            if label_idx < len(row):
                metadata_label = row[label_idx]
            if pid_idx < len(row):
                metadata_pid = row[pid_idx]

            parsed_samples.append((t, ax, ay, az, gx, gy, gz))
        except (ValueError, IndexError):
            continue

    if len(parsed_samples) < 2:
        raise ValueError(f"File {input_path} contains insufficient valid numeric samples.")

    # 1. Sort strictly chronologically
    parsed_samples.sort(key=lambda s: s[0])

    # 2. Deduplicate strictly monotonic timestamps (remove dt <= 0)
    deduped = [parsed_samples[0]]
    for s in parsed_samples[1:]:
        if s[0] > deduped[-1][0]:
            deduped.append(s)

    if len(deduped) < 2:
        raise ValueError(f"File {input_path} has insufficient non-duplicate timestamps.")

    # Convert to numpy arrays
    t_raw = np.array([s[0] for s in deduped], dtype=np.float64)
    ax_raw = np.array([s[1] for s in deduped], dtype=np.float64)
    ay_raw = np.array([s[2] for s in deduped], dtype=np.float64)
    az_raw = np.array([s[3] for s in deduped], dtype=np.float64)
    gx_raw = np.array([s[4] for s in deduped], dtype=np.float64)
    gy_raw = np.array([s[5] for s in deduped], dtype=np.float64)
    gz_raw = np.array([s[6] for s in deduped], dtype=np.float64)

    # 3. Build uniform target grid
    step_ms = 1000.0 / target_hz  # 20.0 ms for 50 Hz
    t_start = t_raw[0]
    t_end = t_raw[-1]
    t_grid = np.arange(t_start, t_end + 1e-6, step_ms)

    if len(t_grid) < 2:
        raise ValueError(f"File {input_path} time span ({t_end - t_start:.1f}ms) is shorter than one sample step.")

    # 4. Perform 1D linear interpolation
    ax_resampled = np.interp(t_grid, t_raw, ax_raw)
    ay_resampled = np.interp(t_grid, t_raw, ay_raw)
    az_resampled = np.interp(t_grid, t_raw, az_raw)
    gx_resampled = np.interp(t_grid, t_raw, gx_raw)
    gy_resampled = np.interp(t_grid, t_raw, gy_raw)
    gz_resampled = np.interp(t_grid, t_raw, gz_raw)

    # 5. Write resampled CSV
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as out_f:
        if channels == 3:
            out_f.write("timestamp_ms,ax,ay,az,label,participant_id\n")
            for i in range(len(t_grid)):
                out_f.write(
                    f"{int(round(t_grid[i]))},"
                    f"{ax_resampled[i]:.6f},{ay_resampled[i]:.6f},{az_resampled[i]:.6f},"
                    f"{metadata_label},{metadata_pid}\n"
                )
        else:
            out_f.write("timestamp_ms,ax,ay,az,gx,gy,gz,label,participant_id\n")
            for i in range(len(t_grid)):
                out_f.write(
                    f"{int(round(t_grid[i]))},"
                    f"{ax_resampled[i]:.6f},{ay_resampled[i]:.6f},{az_resampled[i]:.6f},"
                    f"{gx_resampled[i]:.6f},{gy_resampled[i]:.6f},{gz_resampled[i]:.6f},"
                    f"{metadata_label},{metadata_pid}\n"
                )

    # Verification: check delta-t uniformity
    dts = np.diff(t_grid)
    max_jitter = np.max(np.abs(dts - step_ms))

    return {
        "input_frames": len(lines) - 1,
        "valid_frames": len(deduped),
        "output_frames": len(t_grid),
        "duration_sec": (t_end - t_start) / 1000.0,
        "step_ms": step_ms,
        "max_jitter_ms": float(max_jitter),
        "output_path": output_path,
    }


def main():
    parser = argparse.ArgumentParser(description="Resample IMU CSV logs to a uniform 50 Hz temporal grid.")
    parser.add_argument("-i", "--input", type=str, help="Path to single raw CSV file")
    parser.add_argument("-o", "--output", type=str, help="Path to output resampled CSV file")
    parser.add_argument("-d", "--input-dir", type=str, help="Path to directory containing raw CSV files")
    parser.add_argument("--output-dir", type=str, help="Path to output directory for resampled files")
    parser.add_argument("--target-hz", type=float, default=50.0, help="Target frequency in Hz (default: 50.0 Hz = 20 ms)")
    parser.add_argument("--channels", type=int, choices=[3, 6], default=6,
                        help="3 channels [ax,ay,az] or 6 channels [ax,ay,az,gx,gy,gz] (default: 6)")

    args = parser.parse_args()

    if not args.input and not args.input_dir:
        parser.print_help()
        print("\nError: Please provide either --input or --input-dir.")
        sys.exit(1)

    if args.input:
        out_file = args.output
        if not out_file:
            base, ext = os.path.splitext(args.input)
            suffix = "_50hz_3ch" if args.channels == 3 else "_50hz"
            out_file = f"{base}{suffix}{ext}"

        print(f"[*] Resampling {args.input} -> {out_file} ({args.target_hz} Hz, {args.channels} channels)...")
        stats = resample_single_file(args.input, out_file, args.target_hz, args.channels)
        print(f"    ✔ Raw frames: {stats['input_frames']} -> Resampled: {stats['output_frames']} frames")
        print(f"    ✔ Duration: {stats['duration_sec']:.2f}s | Delta T: {stats['step_ms']:.1f}ms | Jitter: {stats['max_jitter_ms']:.6f}ms")
        print(f"    ✔ Successfully saved to: {stats['output_path']}")

    elif args.input_dir:
        out_dir = args.output_dir or os.path.join(args.input_dir, "resampled_50hz")
        os.makedirs(out_dir, exist_ok=True)
        csv_files = glob.glob(os.path.join(args.input_dir, "*.csv"))

        if not csv_files:
            print(f"[!] No CSV files found in {args.input_dir}")
            sys.exit(1)

        print(f"[*] Processing {len(csv_files)} files in {args.input_dir}...")
        processed = 0
        for csv_path in sorted(csv_files):
            filename = os.path.basename(csv_path)
            out_path = os.path.join(out_dir, filename)
            try:
                stats = resample_single_file(csv_path, out_path, args.target_hz, args.channels)
                print(f"  ✔ [{processed + 1}/{len(csv_files)}] {filename}: {stats['input_frames']} raw -> {stats['output_frames']} resampled ({stats['duration_sec']:.1f}s)")
                processed += 1
            except Exception as e:
                print(f"  ✖ Failed {filename}: {e}")

        print(f"\n[✔] Finished resampling {processed}/{len(csv_files)} files to {out_dir}")

if __name__ == '__main__':
    main()
