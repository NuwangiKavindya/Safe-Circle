import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity } from 'react-native';
import { Marker } from '@maplibre/maplibre-react-native';
import {
  Coordinate,
  lerpCoordinate,
  calculateBearingDegrees,
  calculateDistanceMeters,
  cubicOutEasing,
} from '../utils/markerInterpolator';
import { useTheme } from '../context/ThemeContext';

interface SmoothAnimatedMarkerProps {

  id: string;
  targetCoordinate: Coordinate;
  durationMs?: number;
  markerColor?: string;
  title?: string;
  showHeadingArrow?: boolean;
  maxAccuracyThresholdMeters?: number; // Filter low accuracy fixes (> 35m)
  maxJumpThresholdMeters?: number;     // Instant snap if distance > 300m
  onPress?: () => void;
}

export const SmoothAnimatedMarker: React.FC<SmoothAnimatedMarkerProps> = ({
  id,
  targetCoordinate,
  durationMs = 1500,
  markerColor = '#10B981',
  title,
  showHeadingArrow = true,
  maxAccuracyThresholdMeters = 35,
  maxJumpThresholdMeters = 300,
  onPress,
}) => {
  const { theme } = useTheme();
  const [currentCoordinate, setCurrentCoordinate] = useState<Coordinate>(targetCoordinate);
  const [bearing, setBearing] = useState<number>(0);

  const prevCoordRef = useRef<Coordinate>(targetCoordinate);
  const animationFrameRef = useRef<number | null>(null);

  // Pulsing Halo Animation
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.4,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [pulseAnim]);

  const { latitude, longitude, accuracy } = targetCoordinate;

  useEffect(() => {
    const startCoord = prevCoordRef.current;
    const endCoord = { latitude, longitude, accuracy };

    // 1. Accuracy Check: Ignore low-accuracy noise fixes (> 35m)
    if (accuracy && accuracy > maxAccuracyThresholdMeters) {
      console.log(`[SmoothMarker] Low accuracy fix (${accuracy}m > ${maxAccuracyThresholdMeters}m). Skipping position update.`);
      return;
    }

    // 2. Large GPS Jump Check: Instant snap if distance > 300 meters (teleport / mock location)
    const distMeters = calculateDistanceMeters(startCoord, endCoord);
    if (distMeters > maxJumpThresholdMeters) {
      console.log(`[SmoothMarker] Large GPS jump detected (${distMeters.toFixed(0)}m > ${maxJumpThresholdMeters}m). Applying instant position snap.`);
      setCurrentCoordinate(endCoord);
      prevCoordRef.current = endCoord;
      return;
    }

    // 3. Smooth Lerp 60 FPS Animation Curve for normal movement (< 300m)
    if (distMeters > 0.5) {
      const newBearing = calculateBearingDegrees(startCoord, endCoord);
      setBearing(newBearing);
    }

    const startTime = Date.now();

    const animateStep = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      const eased = cubicOutEasing(progress);
      const interpolated = lerpCoordinate(startCoord, endCoord, eased);
      setCurrentCoordinate(interpolated);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animateStep);
      } else {
        prevCoordRef.current = endCoord;
      }
    };

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = requestAnimationFrame(animateStep);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [
    latitude,
    longitude,
    accuracy,
    durationMs,
    maxAccuracyThresholdMeters,
    maxJumpThresholdMeters,
  ]);

  return (
    <Marker
      id={id}
      lngLat={[currentCoordinate.longitude, currentCoordinate.latitude]}
      onTouchStart={onPress}
      onTouchEnd={onPress}
    >
      <TouchableOpacity
        style={styles.markerContainer}
        onPress={onPress}
        activeOpacity={0.7}
      >
        {/* Pulsing Outer Halo Ring */}
        <Animated.View
          style={[
            styles.pulseHalo,
            {
              backgroundColor: markerColor,
              transform: [{ scale: pulseAnim }],
            },
          ]}
        />

        {/* Marker Core Pin */}
        <View style={[styles.markerCore, { backgroundColor: markerColor }]}>
          {showHeadingArrow ? (
            <View style={{ transform: [{ rotate: `${bearing}deg` }] }}>
              <Text style={styles.arrowIcon}>▲</Text>
            </View>
          ) : (
            <Text style={styles.deviceIcon}>📱</Text>
          )}
        </View>

        {/* Optional Title Badge */}
        {title && (
          <View style={[styles.titleBadge, { backgroundColor: theme.mapMarkerTitleBg, borderColor: theme.mapMarkerTitleBorder }]}>
            <Text style={[styles.titleText, { color: theme.mapMarkerTitleText }]} numberOfLines={1}>
              {title}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Marker>
  );
};

const styles = StyleSheet.create({
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
  },
  pulseHalo: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderRadius: 18,
    opacity: 0.3,
  },
  markerCore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  arrowIcon: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '900',
  },
  deviceIcon: {
    fontSize: 12,
  },
  titleBadge: {
    position: 'absolute',
    bottom: -18,
    backgroundColor: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
  },
  titleText: {
    color: '#F8FAFC',
    fontSize: 9,
    fontWeight: '700',
  },
});
