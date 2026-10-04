import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Easing,
  Platform,
  PermissionsAndroid,
  Alert,
} from 'react-native';
import { magnetometer, SensorTypes, setUpdateIntervalForType } from 'react-native-sensors';
import { calculateDistanceMeters, calculateBearingDegrees } from '../utils/distance';
import { torchService } from '../services/torchService';
import { COLORS } from '../styles/theme';

interface ARViewComponentProps {
  userLatitude: number | null;
  userLongitude: number | null;
  targetLatitude: number | null;
  targetLongitude: number | null;
  targetName?: string;
  onBack: () => void;
}

export const ARViewComponent: React.FC<ARViewComponentProps> = ({
  userLatitude,
  userLongitude,
  targetLatitude,
  targetLongitude,
  targetName = 'Target Device',
  onBack,
}) => {
  // Device heading angle in degrees (0 - 360) from physical magnetometer or manual override
  const [deviceHeading, setDeviceHeading] = useState<number>(0);
  const [isHardwareCompassActive, setIsHardwareCompassActive] = useState<boolean>(false);
  const [useHardwareCompass, setUseHardwareCompass] = useState<boolean>(true);

  // Camera Permission & Torch State
  const [hasCameraPermission, setHasCameraPermission] = useState<boolean | null>(null);
  const [isTorchOn, setIsTorchOn] = useState<boolean>(false);
  const [isTorchAvailable, setIsTorchAvailable] = useState<boolean>(false);
  const [hudFilterMode, setHudFilterMode] = useState<'cyan' | 'night_vision'>('cyan');

  // Pulse animation for target reticle lock
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const arrowRotateAnim = useRef(new Animated.Value(0)).current;
  const lockGlowAnim = useRef(new Animated.Value(0)).current;

  // Request Camera Permission on Mount
  useEffect(() => {
    let isMounted = true;
    const requestCamera = async () => {
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.CAMERA,
            {
              title: 'AR Viewfinder Camera Permission',
              message: 'SafeCircle requires camera access to overlay tactical AR navigation reticles onto your environment.',
              buttonPositive: 'Grant Access',
              buttonNegative: 'Simulate Feed',
            }
          );
          if (isMounted) {
            setHasCameraPermission(granted === PermissionsAndroid.RESULTS.GRANTED);
          }
        } catch (err) {
          console.warn('[AR Camera Permission] Error requesting permission:', err);
          if (isMounted) setHasCameraPermission(false);
        }
      } else {
        if (isMounted) setHasCameraPermission(true);
      }
    };

    requestCamera();

    // Check Torch availability
    torchService.isAvailable().then(avail => {
      if (isMounted) setIsTorchAvailable(avail);
    });

    return () => {
      isMounted = false;
      // Safety: Turn off flashlight when leaving AR view
      torchService.setTorch(false).catch(() => {});
    };
  }, []);

  // Real Hardware Magnetometer Subscription
  useEffect(() => {
    if (!useHardwareCompass) return;

    let sub: any = null;
    try {
      setUpdateIntervalForType(SensorTypes.magnetometer, 100);
      sub = magnetometer.subscribe({
        next: ({ x, y }) => {
          // Magnetometer Azimuth calculation
          let angleDeg = Math.atan2(-x, y) * (180 / Math.PI);
          if (angleDeg < 0) {
            angleDeg += 360;
          }
          setDeviceHeading(Math.round(angleDeg));
          setIsHardwareCompassActive(true);
        },
        error: (err) => {
          console.warn('[AR Magnetometer] Sensor unavailable:', err);
          setIsHardwareCompassActive(false);
        },
      });
    } catch (e: any) {
      console.warn('[AR Magnetometer] Subscription error:', e.message);
      setIsHardwareCompassActive(false);
    }

    return () => {
      if (sub && typeof sub.unsubscribe === 'function') {
        sub.unsubscribe();
      }
    };
  }, [useHardwareCompass]);

  // Calculate real-time distance & bearing
  const hasUserCoords = userLatitude !== null && userLongitude !== null;
  const hasTargetCoords = targetLatitude !== null && targetLongitude !== null;

  const lat1 = hasUserCoords ? userLatitude! : 0;
  const lon1 = hasUserCoords ? userLongitude! : 0;
  const lat2 = hasTargetCoords ? targetLatitude! : 0;
  const lon2 = hasTargetCoords ? targetLongitude! : 0;

  const distanceMeters = (hasUserCoords && hasTargetCoords) ? calculateDistanceMeters(lat1, lon1, lat2, lon2) : 0;
  const targetBearing = (hasUserCoords && hasTargetCoords) ? calculateBearingDegrees(lat1, lon1, lat2, lon2) : 0;

  // Relative arrow rotation angle (Target bearing minus current phone compass heading)
  const relativeAngle = (targetBearing - deviceHeading + 360) % 360;

  // Determine if device is currently facing the target (target is within ±15 degrees)
  const isTargetInCrosshairs = relativeAngle <= 15 || relativeAngle >= 345;

  // Animate reticle pulse
  useEffect(() => {
    const pulseDuration = isTargetInCrosshairs ? 400 : 700;
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: isTargetInCrosshairs ? 1.4 : 1.25,
          duration: pulseDuration,
          useNativeDriver: true,
          easing: Easing.ease,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: pulseDuration,
          useNativeDriver: true,
          easing: Easing.ease,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [pulseAnim, isTargetInCrosshairs]);

  // Smoothly rotate arrow to relativeAngle
  useEffect(() => {
    Animated.timing(arrowRotateAnim, {
      toValue: relativeAngle,
      duration: 300,
      useNativeDriver: true,
    }).start();
  }, [relativeAngle, arrowRotateAnim]);

  // Lock glow animation when target enters crosshairs
  useEffect(() => {
    Animated.timing(lockGlowAnim, {
      toValue: isTargetInCrosshairs ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [isTargetInCrosshairs, lockGlowAnim]);

  const rotateInterpolation = arrowRotateAnim.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  // Toggle Torch/Flashlight
  const handleToggleTorch = async () => {
    const nextState = !isTorchOn;
    const success = await torchService.setTorch(nextState);
    if (success) {
      setIsTorchOn(nextState);
    } else {
      Alert.alert('Torch Unavailable', 'Could not access the physical camera flash unit on this device.');
    }
  };

  // Calculate signal bar percentage based on distance (< 30 meters)
  const signalPercent = Math.max(10, Math.min(100, Math.round((1 - distanceMeters / 30) * 100)));

  // Tactical Colors based on Night Vision filter
  const isNightVision = hudFilterMode === 'night_vision';
  const primaryColor = isNightVision ? '#00FF66' : COLORS.accentCyan;
  const targetHighlight = isTargetInCrosshairs ? (isNightVision ? '#00FF66' : COLORS.accentGreen) : primaryColor;

  return (
    <View style={styles.container}>
      {/* Live / Simulated AR Viewfinder Viewport */}
      <View style={[styles.cameraViewfinder, isNightVision && styles.nightVisionBg]}>
        {/* Tactical HUD Corner Framing Brackets */}
        <View style={[styles.cornerBracket, styles.bracketTopLeft, { borderColor: primaryColor }]} />
        <View style={[styles.cornerBracket, styles.bracketTopRight, { borderColor: primaryColor }]} />
        <View style={[styles.cornerBracket, styles.bracketBottomLeft, { borderColor: primaryColor }]} />
        <View style={[styles.cornerBracket, styles.bracketBottomRight, { borderColor: primaryColor }]} />

        {/* Optical Crosshair Axis Lines */}
        <View style={[styles.gridLineHorizontal, { backgroundColor: isNightVision ? 'rgba(0, 255, 102, 0.18)' : 'rgba(56, 189, 248, 0.15)' }]} />
        <View style={[styles.gridLineVertical, { backgroundColor: isNightVision ? 'rgba(0, 255, 102, 0.18)' : 'rgba(56, 189, 248, 0.15)' }]} />

        {/* Pitch Horizon Marker Hash Marks */}
        <View style={styles.horizonMarksLeft}>
          <Text style={[styles.pitchText, { color: primaryColor }]}>+10°</Text>
          <View style={[styles.pitchTick, { backgroundColor: primaryColor }]} />
          <Text style={[styles.pitchText, { color: primaryColor }]}>0° ──</Text>
          <View style={[styles.pitchTick, { backgroundColor: primaryColor }]} />
          <Text style={[styles.pitchText, { color: primaryColor }]}>-10°</Text>
        </View>

        {/* Camera Status Watermark */}
        <Text style={[styles.cameraWatermarkText, { color: isNightVision ? 'rgba(0, 255, 102, 0.6)' : 'rgba(255, 255, 255, 0.4)' }]}>
          {hasCameraPermission
            ? '📷 OPTICAL HUD SENSOR STREAM • ACTIVE'
            : '📡 SIMULATED HUD SENSOR OVERLAY'}
        </Text>

        {/* Top AR Header Bar */}
        <View style={styles.topHeaderBar}>
          <TouchableOpacity style={[styles.backBtn, { borderColor: primaryColor }]} onPress={onBack} activeOpacity={0.8}>
            <Text style={[styles.backBtnText, { color: primaryColor }]}>← Back to Map</Text>
          </TouchableOpacity>

          {/* Quick Tactical Controls (Torch & Night Vision Mode) */}
          <View style={styles.headerRightActions}>
            {/* Flashlight / Torch Toggle Button */}
            <TouchableOpacity
              style={[
                styles.hudActionBtn,
                isTorchOn && styles.hudActionBtnActive,
                { borderColor: isTorchOn ? COLORS.accentGreen : 'rgba(255, 255, 255, 0.3)' },
              ]}
              onPress={handleToggleTorch}
              activeOpacity={0.7}
            >
              <Text style={styles.hudActionBtnText}>
                {isTorchOn ? '🔦 Torch ON' : '🔦 Torch'}
              </Text>
            </TouchableOpacity>

            {/* Night Vision Tint Toggle */}
            <TouchableOpacity
              style={[
                styles.hudActionBtn,
                isNightVision && styles.hudActionBtnNightVision,
                { borderColor: isNightVision ? '#00FF66' : 'rgba(255, 255, 255, 0.3)' },
              ]}
              onPress={() => setHudFilterMode(prev => prev === 'cyan' ? 'night_vision' : 'cyan')}
              activeOpacity={0.7}
            >
              <Text style={[styles.hudActionBtnText, isNightVision && { color: '#00FF66' }]}>
                {isNightVision ? '🟢 NVG' : '🔵 HUD'}
              </Text>
            </TouchableOpacity>

            {/* Compass / Status Badge */}
            <View
              style={[
                styles.arStatusBadge,
                isHardwareCompassActive && useHardwareCompass
                  ? { backgroundColor: 'rgba(6, 78, 59, 0.9)', borderColor: COLORS.accentGreen }
                  : { backgroundColor: 'rgba(127, 29, 29, 0.9)', borderColor: COLORS.accentRed },
              ]}
            >
              <View
                style={[
                  styles.pulseDot,
                  { backgroundColor: isHardwareCompassActive && useHardwareCompass ? COLORS.accentGreen : COLORS.accentRed },
                ]}
              />
              <Text style={styles.arStatusText}>
                {isHardwareCompassActive && useHardwareCompass
                  ? `${deviceHeading}°`
                  : 'SIM'}
              </Text>
            </View>
          </View>
        </View>

        {/* Central 3D HUD Reticle & Directional Pointer */}
        <View style={styles.hudCenterWrapper}>
          {/* Target Sighted Lock Banner */}
          {isTargetInCrosshairs && (
            <View style={[styles.lockStatusBanner, { borderColor: targetHighlight, backgroundColor: isNightVision ? 'rgba(0, 255, 102, 0.2)' : 'rgba(16, 185, 129, 0.25)' }]}>
              <Text style={[styles.lockStatusText, { color: targetHighlight }]}>
                🎯 TARGET IN CROSSHAIRS • LOCK ACQUIRED
              </Text>
            </View>
          )}

          {/* Outer Pulsing Reticle Ring */}
          <Animated.View
            style={[
              styles.targetReticleRing,
              {
                borderColor: targetHighlight,
                transform: [{ scale: pulseAnim }],
              },
              isTargetInCrosshairs && styles.targetReticleRingLocked,
            ]}
          />

          {/* Precision Target Crosshair Reticle Center */}
          <View style={[styles.crosshairCenterDot, { backgroundColor: targetHighlight }]} />

          {/* Inner Rotating Directional Pointer */}
          <Animated.View
            style={[
              styles.arrowWrapper,
              { transform: [{ rotate: rotateInterpolation }] },
            ]}
          >
            <Text style={[styles.arrowIcon, isTargetInCrosshairs && { transform: [{ scale: 1.15 }] }]}>
              {isTargetInCrosshairs ? '🎯' : '⬆️'}
            </Text>
          </Animated.View>

          {/* Target HUD Information Overlay Card */}
          <View style={[styles.targetInfoBadge, { borderColor: targetHighlight }]}>
            <Text style={styles.targetNameText}>📍 {targetName}</Text>
            <Text style={[styles.targetDistanceText, isTargetInCrosshairs && { color: targetHighlight }]}>
              {distanceMeters.toFixed(1)}m AWAY
            </Text>
            <Text style={[styles.targetHeadingText, isNightVision && { color: '#00FF66' }]}>
              Bearing: {Math.round(targetBearing)}° • Phone Azimuth: {deviceHeading}° • Offset: {Math.round(relativeAngle)}°
            </Text>
            <View style={styles.targetStatusRow}>
              <Text style={[styles.proximityTierBadge, { color: distanceMeters <= 5 ? COLORS.accentRed : distanceMeters <= 15 ? COLORS.accentOrange : COLORS.accentCyan }]}>
                {distanceMeters <= 5 ? '🔥 EXTREME PROXIMITY (<5m)' : distanceMeters <= 15 ? '⚡ FINAL APPROACH (<15m)' : '📡 EN ROUTE'}
              </Text>
            </View>
          </View>
        </View>

        {/* Bottom AR Diagnostics & Signal Strength Panel */}
        <View style={[styles.bottomHudPanel, isNightVision && styles.bottomHudNightVision]}>
          <View style={styles.signalRow}>
            <Text style={[styles.signalLabelText, isNightVision && { color: '#A7F3D0' }]}>
              📡 Proximity Signal Strength:
            </Text>
            <Text style={[styles.signalValueText, { color: targetHighlight }]}>
              {signalPercent}%
            </Text>
          </View>

          <View style={styles.signalBarBg}>
            <View
              style={[
                styles.signalBarFill,
                {
                  width: `${signalPercent}%`,
                  backgroundColor: targetHighlight,
                },
              ]}
            />
          </View>

          {/* Compass Mode Toggle */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginBottom: 8, marginTop: 4 }}>
            <TouchableOpacity
              onPress={() => setUseHardwareCompass(prev => !prev)}
              style={{
                backgroundColor: useHardwareCompass ? 'rgba(0, 230, 118, 0.15)' : 'rgba(255, 255, 255, 0.1)',
                paddingHorizontal: 12,
                paddingVertical: 4,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: useHardwareCompass ? COLORS.accentGreen : 'rgba(255, 255, 255, 0.25)',
              }}
              activeOpacity={0.8}
            >
              <Text style={{ color: useHardwareCompass ? COLORS.accentGreen : '#BBB', fontSize: 11, fontWeight: '700' }}>
                {useHardwareCompass ? '🧭 Real Magnetometer: Active' : '🕹️ Manual Simulation Mode'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Compass Steering Control Buttons for Simulation / Calibration */}
          <View style={styles.controlsRow}>
            <TouchableOpacity
              style={styles.simControlBtn}
              onPress={() => {
                setUseHardwareCompass(false);
                setDeviceHeading((prev) => (prev - 30 + 360) % 360);
              }}
            >
              <Text style={styles.simControlText}>↺ Turn Left (-30°)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.simControlBtn}
              onPress={() => {
                setUseHardwareCompass(false);
                setDeviceHeading(targetBearing);
              }}
            >
              <Text style={[styles.simControlText, { color: COLORS.accentGreen }]}>🎯 Lock Target</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.simControlBtn}
              onPress={() => {
                setUseHardwareCompass(false);
                setDeviceHeading((prev) => (prev + 30) % 360);
              }}
            >
              <Text style={styles.simControlText}>Turn Right (+30°) ↻</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  cameraViewfinder: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#090D16',
    position: 'relative',
    justifyContent: 'space-between',
  },
  nightVisionBg: {
    backgroundColor: '#021A0C',
  },
  // HUD Corner Framing Brackets
  cornerBracket: {
    position: 'absolute',
    width: 28,
    height: 28,
    zIndex: 10,
  },
  bracketTopLeft: {
    top: Platform.OS === 'ios' ? 70 : 40,
    left: 16,
    borderTopWidth: 3,
    borderLeftWidth: 3,
  },
  bracketTopRight: {
    top: Platform.OS === 'ios' ? 70 : 40,
    right: 16,
    borderTopWidth: 3,
    borderRightWidth: 3,
  },
  bracketBottomLeft: {
    bottom: 140,
    left: 16,
    borderBottomWidth: 3,
    borderLeftWidth: 3,
  },
  bracketBottomRight: {
    bottom: 140,
    right: 16,
    borderBottomWidth: 3,
    borderRightWidth: 3,
  },
  gridLineHorizontal: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    height: 1,
  },
  gridLineVertical: {
    position: 'absolute',
    left: '50%',
    top: 0,
    bottom: 0,
    width: 1,
  },
  horizonMarksLeft: {
    position: 'absolute',
    left: 20,
    top: '44%',
    zIndex: 5,
  },
  pitchText: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginVertical: 2,
  },
  pitchTick: {
    width: 14,
    height: 1.5,
    marginVertical: 4,
    opacity: 0.6,
  },
  cameraWatermarkText: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 56 : 16,
    right: 16,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    zIndex: 2,
  },
  topHeaderBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 50 : 20,
    paddingBottom: 12,
    zIndex: 99,
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hudActionBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  hudActionBtnActive: {
    backgroundColor: 'rgba(16, 185, 129, 0.25)',
  },
  hudActionBtnNightVision: {
    backgroundColor: 'rgba(0, 255, 102, 0.2)',
  },
  hudActionBtnText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
  },
  backBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 24,
    borderWidth: 1,
  },
  backBtnText: {
    fontSize: 13,
    fontWeight: '800',
  },
  arStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
  },
  pulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 6,
  },
  arStatusText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  hudCenterWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 'auto',
  },
  lockStatusBanner: {
    paddingVertical: 4,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 16,
  },
  lockStatusText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  targetReticleRing: {
    width: 180,
    height: 180,
    borderRadius: 90,
    borderWidth: 2,
    borderStyle: 'dashed',
    position: 'absolute',
    backgroundColor: 'rgba(56, 189, 248, 0.04)',
  },
  targetReticleRingLocked: {
    borderStyle: 'solid',
    borderWidth: 3,
    backgroundColor: 'rgba(16, 185, 129, 0.08)',
  },
  crosshairCenterDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    position: 'absolute',
    zIndex: 15,
  },
  arrowWrapper: {
    width: 80,
    height: 80,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 20,
  },
  arrowIcon: {
    fontSize: 52,
  },
  targetInfoBadge: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    alignItems: 'center',
    marginTop: 24,
    borderWidth: 1,
    elevation: 10,
    shadowColor: COLORS.accentCyan,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  targetNameText: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: '800',
  },
  targetDistanceText: {
    color: COLORS.accentRed,
    fontSize: 22,
    fontWeight: '900',
    marginVertical: 4,
  },
  targetHeadingText: {
    color: COLORS.textSecondary,
    fontSize: 10,
  },
  targetStatusRow: {
    marginTop: 6,
  },
  proximityTierBadge: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  bottomHudPanel: {
    backgroundColor: 'rgba(15, 23, 42, 0.95)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
  bottomHudNightVision: {
    backgroundColor: 'rgba(2, 26, 12, 0.95)',
    borderColor: 'rgba(0, 255, 102, 0.25)',
  },
  signalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  signalLabelText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  signalValueText: {
    fontSize: 14,
    fontWeight: '800',
  },
  signalBarBg: {
    height: 8,
    backgroundColor: COLORS.bgDark,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
  signalBarFill: {
    height: '100%',
  },
  controlsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  simControlBtn: {
    flex: 1,
    backgroundColor: COLORS.cardBg,
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
  simControlText: {
    color: COLORS.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
});
