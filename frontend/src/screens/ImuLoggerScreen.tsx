/**
 * ImuLoggerScreen.tsx
 *
 * DEV-ONLY screen for recording raw accelerometer + gyroscope data to CSV files.
 * Used to collect training data for the TFLite theft-detection model.
 *
 * NOT included in production builds — only rendered when __DEV__ === true.
 *
 * Output files: /sdcard/Download/safecircle_imu/{participantId}_{label}_{timestamp}.csv
 * Pull to laptop: adb pull /sdcard/Download/safecircle_imu/ ~/safecircle_dataset/
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  NativeModules,
} from 'react-native';
import RNFS from 'react-native-fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityLabel = 'NORMAL' | 'THEFT' | 'WALK' | 'POCKET' | 'SIT' | 'JOG';

interface RawSample {
  t: number;
  ax: number;
  ay: number;
  az: number;
  gx: number;
  gy: number;
  gz: number;
}

interface SavedSession {
  filename: string;
  frameCount: number;
  label: ActivityLabel;
  savedAt: string;
}

interface ImuLoggerScreenProps {
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ACTIVITY_LABELS: ActivityLabel[] = ['NORMAL', 'THEFT', 'WALK', 'POCKET', 'SIT', 'JOG'];
const SAMPLE_INTERVAL_MS = 20; // 50 Hz
const MIN_FRAMES = 50;         // ~1 second minimum
const MAX_FRAMES = 500;        // ~10 seconds maximum
const OUTPUT_DIR = `${RNFS.DownloadDirectoryPath}/safecircle_imu`;

const LABEL_COLOURS: Record<ActivityLabel, string> = {
  NORMAL:  '#16a34a',
  THEFT:   '#dc2626',
  WALK:    '#2563eb',
  POCKET:  '#7c3aed',
  SIT:     '#0891b2',
  JOG:     '#d97706',
};

const LABEL_ICONS: Record<ActivityLabel, string> = {
  NORMAL:  '🟢',
  THEFT:   '🔴',
  WALK:    '🚶',
  POCKET:  '🕴️',
  SIT:     '🪑',
  JOG:     '🏃',
};

// ---------------------------------------------------------------------------
// Sensor access (same dynamic-require pattern as motionService.ts)
// ---------------------------------------------------------------------------

let sensorsModule: any = null;
try {
  sensorsModule = require('react-native-sensors');
} catch (_) {
  sensorsModule = null;
}

// ---------------------------------------------------------------------------
// Fixed-Rate 50Hz Linear Resampling Engine
// ---------------------------------------------------------------------------

/**
 * Resamples non-uniform hardware sensor time series to a strict 50 Hz grid (20.0ms step).
 * Solves jitter, duplicate timestamps, and bridge queue batching.
 */
function resampleTo50Hz(raw: RawSample[], label: string, pid: string): string[] {
  if (raw.length < 2) return [];

  // 1. Sort chronologically
  const sorted = [...raw].sort((a, b) => a.t - b.t);

  // 2. Deduplicate consecutive samples with identical or retrograde timestamps
  const deduped: RawSample[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === 0 || sorted[i].t > deduped[deduped.length - 1].t) {
      deduped.push(sorted[i]);
    }
  }

  if (deduped.length < 2) return [];

  const tStart = deduped[0].t;
  const tEnd = deduped[deduped.length - 1].t;
  const stepMs = 20.0; // 50 Hz = exactly 20.0ms per sample frame

  const rows: string[] = [];
  let idx = 0;

  for (let targetT = tStart; targetT <= tEnd; targetT += stepMs) {
    // Advance idx to bracket targetT between deduped[idx] and deduped[idx + 1]
    while (idx < deduped.length - 2 && deduped[idx + 1].t < targetT) {
      idx++;
    }

    const p1 = deduped[idx];
    const p2 = deduped[idx + 1];
    const dt = p2.t - p1.t;
    const alpha = dt > 0 ? Math.min(Math.max((targetT - p1.t) / dt, 0), 1) : 0;

    const ax = p1.ax + alpha * (p2.ax - p1.ax);
    const ay = p1.ay + alpha * (p2.ay - p1.ay);
    const az = p1.az + alpha * (p2.az - p1.az);
    const gx = p1.gx + alpha * (p2.gx - p1.gx);
    const gy = p1.gy + alpha * (p2.gy - p1.gy);
    const gz = p1.gz + alpha * (p2.gz - p1.gz);

    // Guaranteed exact 20ms steps on every row
    rows.push(
      `${Math.round(targetT)},${ax.toFixed(6)},${ay.toFixed(6)},${az.toFixed(6)},${gx.toFixed(6)},${gy.toFixed(6)},${gz.toFixed(6)},${label},${pid}`
    );
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const ImuLoggerScreen: React.FC<ImuLoggerScreenProps> = ({ onBack }) => {
  const [participantId, setParticipantId] = useState('P01');
  const [selectedLabel, setSelectedLabel] = useState<ActivityLabel | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [isGyroAvailable, setIsGyroAvailable] = useState<boolean | null>(null);

  // Refs to hold mutable recording state without triggering re-renders on every frame
  const rawSamplesRef = useRef<RawSample[]>([]);
  const accelSubRef = useRef<any>(null);
  const gyroSubRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const currentGyroRef = useRef({ gx: 0, gy: 0, gz: 0 });
  const frameCountRef = useRef(0);
  // Keep a stable ref to selectedLabel so the accelerometer callback can read it
  const selectedLabelRef = useRef<ActivityLabel | null>(null);

  // ---------------------------------------------------------------------------
  // Check Gyroscope Hardware on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let isMounted = true;

    if (!sensorsModule) {
      setIsGyroAvailable(false);
      return;
    }

    const { RNSensorsGyroscope } = NativeModules;
    if (RNSensorsGyroscope && typeof RNSensorsGyroscope.isAvailable === 'function') {
      RNSensorsGyroscope.isAvailable()
        .then(() => {
          if (isMounted) setIsGyroAvailable(true);
        })
        .catch(() => {
          if (isMounted) setIsGyroAvailable(false);
        });
    } else {
      // Test subscription directly
      const { gyroscope } = sensorsModule;
      if (gyroscope && typeof gyroscope.subscribe === 'function') {
        const sub = gyroscope.subscribe(
          () => {
            if (isMounted) setIsGyroAvailable(true);
            if (sub?.unsubscribe) sub.unsubscribe();
          },
          () => {
            if (isMounted) setIsGyroAvailable(false);
          }
        );
        return () => {
          isMounted = false;
          if (sub?.unsubscribe) sub.unsubscribe();
        };
      } else {
        setIsGyroAvailable(false);
      }
    }

    return () => {
      isMounted = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Start recording
  // ---------------------------------------------------------------------------

  const startRecording = useCallback(() => {
    if (!participantId.trim()) {
      Alert.alert('Missing Participant ID', 'Please enter a Participant ID before recording.');
      return;
    }
    if (!selectedLabel) {
      Alert.alert('No Label Selected', 'Please select an activity label before recording.');
      return;
    }
    if (!sensorsModule) {
      Alert.alert('Sensors Unavailable', 'react-native-sensors module is not available on this device.');
      return;
    }

    const { accelerometer, gyroscope, SensorTypes, setUpdateIntervalForType } = sensorsModule;

    // Sync label ref so the async accelerometer callback sees the current value
    selectedLabelRef.current = selectedLabel;

    // Reset raw buffer and state
    rawSamplesRef.current = [];
    currentGyroRef.current = { gx: 0, gy: 0, gz: 0 };
    frameCountRef.current = 0;
    setFrameCount(0);
    setElapsedSec(0);
    setIsRecording(true);

    // Set 50 Hz interval hint on sensors
    setUpdateIntervalForType(SensorTypes.accelerometer, SAMPLE_INTERVAL_MS);
    setUpdateIntervalForType(SensorTypes.gyroscope, SAMPLE_INTERVAL_MS);

    // Gyroscope subscription
    if (gyroscope && typeof gyroscope.subscribe === 'function') {
      gyroSubRef.current = gyroscope.subscribe(
        ({ x, y, z }: { x: number; y: number; z: number }) => {
          currentGyroRef.current = { gx: x, gy: y, gz: z };
          setIsGyroAvailable(true);
        },
        (err: any) => {
          console.warn('[ImuLogger] Gyroscope error:', err);
          setIsGyroAvailable(false);
        },
      );
    }

    // Accelerometer subscription — collects hardware timestamps and raw IMU vectors
    accelSubRef.current = accelerometer.subscribe(
      (data: any) => {
        const ax = data.x ?? 0;
        const ay = data.y ?? 0;
        const az = data.z ?? 0;

        // Use true hardware timestamp from sensor HAL if present, otherwise epoch ms
        const rawTs = typeof data.timestamp === 'number' && data.timestamp > 0
          ? data.timestamp
          : Date.now();

        const { gx, gy, gz } = currentGyroRef.current;

        rawSamplesRef.current.push({
          t: rawTs,
          ax,
          ay,
          az,
          gx,
          gy,
          gz,
        });

        frameCountRef.current += 1;
        // Update UI counter every 5 frames to avoid excessive re-renders
        if (frameCountRef.current % 5 === 0) {
          setFrameCount(frameCountRef.current);
        }

        // Auto-stop at MAX_FRAMES
        if (frameCountRef.current >= MAX_FRAMES) {
          stopAndSave();
        }
      },
      (err: any) => console.warn('[ImuLogger] Accelerometer error:', err),
    );

    // Elapsed-time ticker (every 100 ms for smooth display)
    let elapsed = 0;
    timerRef.current = setInterval(() => {
      elapsed += 0.1;
      setElapsedSec(parseFloat(elapsed.toFixed(1)));
    }, 100);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantId, selectedLabel]);

  // ---------------------------------------------------------------------------
  // Stop and save
  // ---------------------------------------------------------------------------

  const stopAndSave = useCallback(async () => {
    // Unsubscribe sensors
    if (accelSubRef.current?.unsubscribe) accelSubRef.current.unsubscribe();
    if (gyroSubRef.current?.unsubscribe)  gyroSubRef.current.unsubscribe();
    accelSubRef.current = null;
    gyroSubRef.current  = null;

    // Stop elapsed ticker
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setIsRecording(false);

    const rawSamples = rawSamplesRef.current;
    const label = selectedLabelRef.current ?? 'UNKNOWN';
    const pid = participantId.trim();

    // Guard: discard if too short
    if (rawSamples.length < MIN_FRAMES) {
      Alert.alert(
        'Clip Too Short',
        `Only ${rawSamples.length} raw frames recorded (~${(rawSamples.length * 0.02).toFixed(1)}s).\nMinimum is ${MIN_FRAMES} frames (~1s). Clip discarded.`,
      );
      rawSamplesRef.current = [];
      frameCountRef.current = 0;
      setFrameCount(0);
      setElapsedSec(0);
      return;
    }

    // ── Resample onto uniform 50 Hz grid (20.0ms delta per row) ──
    const rows = resampleTo50Hz(rawSamples, label, pid);
    const frames = rows.length;

    if (frames < MIN_FRAMES) {
      Alert.alert(
        'Clip Too Short After Resampling',
        `Duration was insufficient to generate ${MIN_FRAMES} uniform 50Hz frames. Clip discarded.`,
      );
      rawSamplesRef.current = [];
      frameCountRef.current = 0;
      setFrameCount(0);
      setElapsedSec(0);
      return;
    }

    setFrameCount(frames);

    // Build CSV content
    const header = 'timestamp_ms,ax,ay,az,gx,gy,gz,label,participant_id\n';
    const csvContent = header + rows.join('\n');

    // Filename: P01_THEFT_1727087501882.csv
    const ts = Date.now();
    const filename = `${pid}_${label}_${ts}.csv`;
    const filePath = `${OUTPUT_DIR}/${filename}`;

    try {
      // Ensure output directory exists
      const dirExists = await RNFS.exists(OUTPUT_DIR);
      if (!dirExists) {
        await RNFS.mkdir(OUTPUT_DIR);
      }

      await RNFS.writeFile(filePath, csvContent, 'utf8');

      setSavedSessions(prev => [
        {
          filename,
          frameCount: frames,
          label: label as ActivityLabel,
          savedAt: new Date(ts).toLocaleTimeString(),
        },
        ...prev,
      ]);

      Alert.alert(
        '✅ 50Hz Clip Saved',
        `${frames} uniform frames (${(frames * 0.02).toFixed(1)}s at 50Hz) saved.\nEvery row is exactly 20ms apart.\n\nFile:\n${filename}\n\nPull all clips to laptop:\nadb pull ${OUTPUT_DIR}/ ~/safecircle_dataset/`,
      );
    } catch (err: any) {
      Alert.alert('Save Failed', `Could not write file:\n${err.message}`);
    }

    // Reset counters; label stays selected for the next clip
    rawSamplesRef.current = [];
    frameCountRef.current = 0;
    setFrameCount(0);
    setElapsedSec(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [participantId]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const canStart = participantId.trim().length > 0 && selectedLabel !== null;

  return (
    <View style={styles.container}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack} activeOpacity={0.7}>
          <Text style={styles.backBtnText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>🔬 IMU Data Logger</Text>
        <View style={styles.devBadge}>
          <Text style={styles.devBadgeText}>DEV ONLY</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Hardware Gyroscope Warning Banner ── */}
        {isGyroAvailable === false && (
          <View style={styles.gyroWarningBanner}>
            <Text style={styles.gyroWarningTitle}>⚠️ Hardware Gyroscope Unavailable</Text>
            <Text style={styles.gyroWarningBody}>
              This device has no physical gyroscope sensor. Gyro readings (gx, gy, gz) will be logged as 0.000000. Accelerometer (ax, ay, az) is actively sampled at 50 Hz.
            </Text>
          </View>
        )}

        {/* ── Sensor Status Row ── */}
        <View style={styles.sensorStatusRow}>
          <View style={styles.sensorBadge}>
            <Text style={styles.sensorBadgeText}>Accel: 🟢 Active (50 Hz)</Text>
          </View>
          <View style={styles.sensorBadge}>
            <Text style={styles.sensorBadgeText}>
              Gyro: {isGyroAvailable === false ? '🔴 Absent' : isGyroAvailable === true ? '🟢 Active' : '🟡 Checking...'}
            </Text>
          </View>
        </View>

        {/* ── Participant ID ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Participant ID</Text>
          <TextInput
            style={styles.participantInput}
            value={participantId}
            onChangeText={setParticipantId}
            placeholder="e.g. P01, P02 ..."
            placeholderTextColor="#64748b"
            autoCapitalize="characters"
            editable={!isRecording}
            maxLength={10}
          />
        </View>

        {/* ── Activity Label Picker ── */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Activity Label</Text>
          <View style={styles.labelGrid}>
            {ACTIVITY_LABELS.map(label => {
              const isSelected = selectedLabel === label;
              return (
                <TouchableOpacity
                  key={label}
                  style={[
                    styles.labelBtn,
                    isSelected && {
                      backgroundColor: LABEL_COLOURS[label],
                      borderColor: LABEL_COLOURS[label],
                    },
                  ]}
                  onPress={() => !isRecording && setSelectedLabel(label)}
                  activeOpacity={0.7}
                  disabled={isRecording}
                >
                  <Text style={styles.labelBtnIcon}>{LABEL_ICONS[label]}</Text>
                  <Text style={[
                    styles.labelBtnText,
                    isSelected && { color: '#fff', fontWeight: '800' },
                  ]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Record Button ── */}
        <View style={styles.section}>
          <TouchableOpacity
            style={[
              styles.recordBtn,
              isRecording
                ? styles.recordBtnActive
                : canStart
                  ? styles.recordBtnIdle
                  : styles.recordBtnDisabled,
            ]}
            onPress={isRecording ? stopAndSave : startRecording}
            activeOpacity={0.8}
            disabled={!isRecording && !canStart}
          >
            <Text style={styles.recordBtnText}>
              {isRecording ? '⏹  Stop & Save' : '⏺  Start Recording'}
            </Text>
          </TouchableOpacity>
          {!canStart && !isRecording && (
            <Text style={styles.disabledHint}>
              {!participantId.trim()
                ? '⚠ Enter a Participant ID above'
                : '⚠ Select an activity label above'}
            </Text>
          )}
        </View>

        {/* ── Live Stats (visible only while recording) ── */}
        {isRecording && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{frameCount}</Text>
              <Text style={styles.statLabel}>frames</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{elapsedSec.toFixed(1)}s</Text>
              <Text style={styles.statLabel}>elapsed</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: LABEL_COLOURS[selectedLabel!] }]}>
                {selectedLabel}
              </Text>
              <Text style={styles.statLabel}>label</Text>
            </View>
          </View>
        )}

        {/* ── Hint / Instructions ── */}
        {!isRecording && (
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>
              📋 Record 50–500 frames per clip (~1–10 seconds).{'\n'}
              Aim for 80+ clips per label across 5+ participants.{'\n\n'}
              Pull files to laptop:{'\n'}
              <Text style={styles.hintCode}>
                adb pull {OUTPUT_DIR}/ ~/safecircle_dataset/
              </Text>
            </Text>
          </View>
        )}

        {/* ── Saved Sessions ── */}
        {savedSessions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              Saved Sessions (this run) — {savedSessions.length}
            </Text>
            {savedSessions.map((session, idx) => (
              <View key={idx} style={styles.sessionRow}>
                <View style={[styles.sessionDot, { backgroundColor: LABEL_COLOURS[session.label] }]} />
                <View style={styles.sessionInfo}>
                  <Text style={styles.sessionFilename} numberOfLines={1}>
                    {session.filename}
                  </Text>
                  <Text style={styles.sessionMeta}>
                    {session.frameCount} frames •{' '}
                    {(session.frameCount * 0.02).toFixed(1)}s •{' '}
                    {session.savedAt}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? 16 : 54,
    paddingBottom: 12,
    backgroundColor: '#1e293b',
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  backBtnText: {
    color: '#94a3b8',
    fontSize: 14,
    fontWeight: '600',
  },
  headerTitle: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '800',
  },
  devBadge: {
    backgroundColor: '#7c2d12',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ea580c',
  },
  devBadgeText: {
    color: '#fed7aa',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  gyroWarningBanner: {
    backgroundColor: '#451a03',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#d97706',
    padding: 14,
    marginBottom: 20,
  },
  gyroWarningTitle: {
    color: '#fbbf24',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  gyroWarningBody: {
    color: '#fef3c7',
    fontSize: 12,
    lineHeight: 18,
  },
  sensorStatusRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  sensorBadge: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
  sensorBadgeText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
  },
  section: {
    marginBottom: 24,
  },
  sectionLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 10,
  },
  participantInput: {
    backgroundColor: '#1e293b',
    color: '#f1f5f9',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 1,
  },
  labelGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  labelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    minWidth: '30%',
  },
  labelBtnIcon: {
    fontSize: 15,
  },
  labelBtnText: {
    color: '#94a3b8',
    fontSize: 13,
    fontWeight: '600',
  },
  recordBtn: {
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordBtnIdle: {
    backgroundColor: '#16a34a',
  },
  recordBtnActive: {
    backgroundColor: '#dc2626',
  },
  recordBtnDisabled: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
  },
  recordBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  disabledHint: {
    color: '#64748b',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    alignItems: 'center',
  },
  statValue: {
    color: '#38bdf8',
    fontSize: 22,
    fontWeight: '900',
    marginBottom: 2,
  },
  statLabel: {
    color: '#64748b',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hintBox: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 14,
    marginBottom: 24,
  },
  hintText: {
    color: '#64748b',
    fontSize: 12,
    lineHeight: 20,
  },
  hintCode: {
    color: '#38bdf8',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    fontSize: 11,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    marginBottom: 8,
    gap: 12,
  },
  sessionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    flexShrink: 0,
  },
  sessionInfo: {
    flex: 1,
  },
  sessionFilename: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Courier',
    marginBottom: 2,
  },
  sessionMeta: {
    color: '#64748b',
    fontSize: 11,
  },
});
