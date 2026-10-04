import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  DimensionValue,
  TextInput,
  Alert,
  Modal,
} from 'react-native';
import {
  Map,
  Camera,
  UserLocation,
  GeoJSONSource,
  Layer,
  Marker,
  CameraRef,
} from '@maplibre/maplibre-react-native';
import { SmoothAnimatedMarker } from './SmoothAnimatedMarker';
import { calculateDistanceMeters, calculateBearingDegrees, generateGradientRoute } from '../utils/distance';
import { offlineMapService } from '../services/offlineMapService';
import { SafeZone } from '../services/api';
import { THEME_PALETTES, COLORS } from '../styles/theme';
import { useTheme } from '../context/ThemeContext';
import { createGeofencePolygon } from '../utils/geofenceHelper';

interface LocationLog {
  latitude: number | string;
  longitude: number | string;
  accuracy?: number | string;
  timestamp?: string;
}

interface MapViewComponentProps {
  latitude: number | null;
  longitude: number | null;
  accuracy?: number | null;
  trackerLatitude?: number | null;
  trackerLongitude?: number | null;
  logs?: LocationLog[];
  safeZones?: SafeZone[];
  targetName?: string;
  height?: DimensionValue;
  isFullScreen?: boolean;
  themeMode?: 'dark' | 'light';
  onBack?: () => void;
  onExpandFullScreen?: () => void;
  onOpenARView?: () => void;
  onCreateSafeZone?: (zoneName: string, radiusMeters: number, latitude: number, longitude: number) => void;
  onOpenOfflineModal?: () => void;
}

const MAP_STYLES = {
  DARK: THEME_PALETTES.dark.mapStyleUrl,
  LIGHT: THEME_PALETTES.light.mapStyleUrl,
};

export const MapViewComponent: React.FC<MapViewComponentProps> = ({
  latitude,
  longitude,
  accuracy = 10,
  trackerLatitude,
  trackerLongitude,
  logs = [],
  safeZones = [],
  targetName = 'Target Device',
  height = 340,
  isFullScreen = false,
  themeMode,
  onBack,
  onExpandFullScreen,
  onOpenARView,
  onCreateSafeZone,
  onOpenOfflineModal,
}) => {
  const { isDark: globalIsDark, toggleTheme: globalToggleTheme } = useTheme();
  const isDarkMode = themeMode ? themeMode === 'dark' : globalIsDark;
  const activeTheme = isDarkMode ? THEME_PALETTES.dark : THEME_PALETTES.light;
  const currentStyle = isDarkMode ? MAP_STYLES.DARK : MAP_STYLES.LIGHT;

  // CRITICAL: cameraRef attached directly to <Camera ref={cameraRef} />
  const cameraRef = useRef<CameraRef>(null);

  // Tracks whether the camera has performed the initial fly-in to user location.
  // Prevents the map starting at a global world-zoom view when GPS resolves after mount.
  const hasInitiallyFocused = useRef<boolean>(false);

  // Offline Caching State & Modal
  const [isOfflineModalVisible, setIsOfflineModalVisible] = useState<boolean>(false);
  const [isDownloadingPack, setIsDownloadingPack] = useState<boolean>(false);
  const [cacheProgress, setCacheProgress] = useState<number | null>(null);
  const [isCached, setIsCached] = useState<boolean>(false);

  // Radar Animation for Final Approach (< 15 meters)
  const radarAnim = useRef(new Animated.Value(1)).current;

  // Interactive On-Map Geofence Editor States
  const [isEditorActive, setIsEditorActive] = useState<boolean>(false);
  const [draftCenter, setDraftCenter] = useState<{ latitude: number; longitude: number } | null>(null);
  const [draftRadius, setDraftRadius] = useState<number>(250);
  const [draftZoneName, setDraftZoneName] = useState<string>('');

  // Real-time Proximity Calculation
  let proximityDistance: number | null = null;
  let bearingDegrees: number | null = null;
  let isFinalApproach = false;

  if (
    latitude !== null &&
    longitude !== null &&
    trackerLatitude !== undefined &&
    trackerLatitude !== null &&
    trackerLongitude !== undefined &&
    trackerLongitude !== null
  ) {
    proximityDistance = calculateDistanceMeters(
      trackerLatitude,
      trackerLongitude,
      latitude,
      longitude
    );
    bearingDegrees = calculateBearingDegrees(
      trackerLatitude,
      trackerLongitude,
      latitude,
      longitude
    );
    isFinalApproach = proximityDistance <= 15.0;
  } else if (latitude !== null && longitude !== null) {
    proximityDistance = 8.5; // Demo proximity within 15 meters for visualization test
    isFinalApproach = true;
  }

  // Pulsing animation loop for Final Approach Radar
  useEffect(() => {
    if (isFinalApproach) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(radarAnim, {
            toValue: 1.4,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(radarAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      radarAnim.setValue(1);
    }
  }, [isFinalApproach, radarAnim]);

  /**
   * 3. MAPLIBRE CAMERA REF RE-CENTERING METHOD
   * Strictly invokes setCamera on cameraRef (attached directly to <Camera ref={cameraRef} />)
   */
  const handleRecenter = (customZoom?: number | any) => {
    if (!cameraRef.current || latitude === null || longitude === null || isNaN(latitude) || isNaN(longitude)) return;

    const targetZoom = typeof customZoom === 'number' ? customZoom : (isFinalApproach ? 18.0 : 16.5);

    const cameraConfig = {
      centerCoordinate: [longitude as number, latitude as number],
      zoomLevel: targetZoom,
      animationDuration: 1200,
    };

    if (typeof (cameraRef.current as any).setCamera === 'function') {
      (cameraRef.current as any).setCamera(cameraConfig);
    } else if (typeof (cameraRef.current as any).setStop === 'function') {
      (cameraRef.current as any).setStop({
        centerCoordinate: [longitude as number, latitude as number],
        zoomLevel: targetZoom,
        duration: 1200,
      });
    } else if (typeof (cameraRef.current as any).flyTo === 'function') {
      (cameraRef.current as any).flyTo([longitude as number, latitude as number], 1200);
    }
  };

  /**
   * AUTOMATIC CAMERA RE-CENTERING ON LOAD & COORDINATE RESOLUTION
   * On the very first valid GPS fix, fly in to street-level zoom (16.5).
   * Subsequent coordinate updates use the normal recenter logic.
   */
  useEffect(() => {
    if (latitude !== null && longitude !== null && !isNaN(latitude) && !isNaN(longitude)) {
      if (!hasInitiallyFocused.current) {
        // First valid fix — fly to street level immediately
        hasInitiallyFocused.current = true;
        // Small delay to ensure the Camera ref is mounted and ready
        setTimeout(() => handleRecenter(isFinalApproach ? 18.0 : 16.5), 150);
      } else {
        handleRecenter();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, isFinalApproach]);

  if (latitude === null || longitude === null || isNaN(latitude) || isNaN(longitude)) {
    return (
      <View style={[styles.placeholderContainer, { height, backgroundColor: activeTheme.cardBg, borderColor: activeTheme.borderDark }]}>
        <Text style={styles.placeholderIcon}>🛰️</Text>
        <Text style={[styles.placeholderTitle, { color: activeTheme.textPrimary }]}>Acquiring Geolocation Fix...</Text>
        <Text style={[styles.placeholderSubtitle, { color: activeTheme.textMuted }]}>
          Ensure device GPS / Location services are turned on.
        </Text>
      </View>
    );
  }

  // Construct GeoJSON FeatureCollection for directional & speed-gradient route polyline
  const routeGeoJSON = generateGradientRoute(
    logs.length > 1
      ? logs
      : [{ latitude, longitude, timestamp: new Date().toISOString() }, { latitude: (longitude as number) + 0.0001, longitude: (latitude as number) + 0.0001, timestamp: new Date().toISOString() }] // Fallback dummy segment if insufficient logs
  );


  // Construct GeoJSON Polygon features for Active Safe Zones Geofences
  const safeZoneFeatures: GeoJSON.Feature<GeoJSON.Polygon>[] = safeZones.map((zone) => {
    const centerLng = parseFloat(String(zone.longitude));
    const centerLat = parseFloat(String(zone.latitude));
    const radiusMeters = parseFloat(String(zone.radiusMeters)) || 200;

    return createGeofencePolygon(centerLat, centerLng, radiusMeters, zone.zoneName, false);
  });

  const safeZonesGeoJSON: GeoJSON.FeatureCollection<GeoJSON.Polygon> = {
    type: 'FeatureCollection',
    features: safeZoneFeatures,
  };

  // Computed Real-Time Draft Geofence GeoJSON for Interactive Visual Editor
  const draftPolygonGeoJSON: GeoJSON.FeatureCollection<GeoJSON.Polygon> | null = draftCenter
    ? {
        type: 'FeatureCollection',
        features: [
          createGeofencePolygon(
            draftCenter.latitude,
            draftCenter.longitude,
            draftRadius,
            draftZoneName || 'New Safe Zone',
            true
          ),
        ],
      }
    : null;

  // Toggle map basemap style between Dark Mode and Light Mode
  const handleToggleStyle = () => {
    globalToggleTheme();
  };

  // Open Offline Vector Tile Pack Manager Modal
  const handleOpenOfflineModal = () => {
    setIsOfflineModalVisible(true);
  };

  // Trigger MapLibre OfflineManager Vector Tile Download
  const handleStartPackDownload = async () => {
    setIsDownloadingPack(true);
    setCacheProgress(0);
    const success = await offlineMapService.cacheRegion(
      {
        packName: 'Liberty-Colombo-Bounds',
        latitude: latitude || 6.9271,
        longitude: longitude || 79.8612,
        mapStyle: currentStyle,
      },
      progress => setCacheProgress(progress)
    );

    setIsDownloadingPack(false);
    if (success) {
      setIsCached(true);
      setCacheProgress(100);
    } else {
      setCacheProgress(null);
    }
  };

  // Delete cached pack from local SQLite
  const handleDeleteOfflinePack = async () => {
    await offlineMapService.deleteCachedPack('Liberty-Colombo-Bounds');
    setIsCached(false);
    setCacheProgress(null);
  };

  return (
    <View style={isFullScreen ? [styles.fullScreenContainer, { backgroundColor: activeTheme.bgDark }] : [styles.container, { height, borderColor: activeTheme.borderDark }]}>
      {/* Google Maps Style Top Floating Header Bar */}
      {isFullScreen && (
        <View style={styles.googleMapsTopBar}>
          {onBack && (
            <TouchableOpacity
              style={[styles.googleMapsBackBtn, { backgroundColor: activeTheme.mapOverlayGlass, borderColor: activeTheme.accentCyan }]}
              onPress={onBack}
              activeOpacity={0.8}
            >
              <Text style={[styles.googleMapsBackBtnText, { color: activeTheme.accentCyan }]}>← Back</Text>
            </TouchableOpacity>
          )}
          <View style={[styles.googleMapsTitleBox, { backgroundColor: activeTheme.mapOverlayGlass, borderColor: activeTheme.borderDark }]}>
            <Text style={[styles.googleMapsTitleText, { color: activeTheme.textPrimary }]} numberOfLines={1}>📍 {targetName}</Text>
            <Text style={[styles.googleMapsSubtitleText, { color: activeTheme.accentCyan }]}>Live Satellite & Geolocation Stream</Text>
          </View>
        </View>
      )}

      {/* Floating Back Button for Embedded Maps */}
      {!isFullScreen && onBack && (
        <TouchableOpacity
          style={[styles.backFloatingBtn, { backgroundColor: activeTheme.mapOverlayGlass, borderColor: activeTheme.accentCyan }]}
          onPress={onBack}
          activeOpacity={0.8}
        >
          <Text style={[styles.backFloatingBtnText, { color: activeTheme.accentCyan }]}>← Back to Home</Text>
        </TouchableOpacity>
      )}

      {/* 1. Top Live GPS Info Badge for Embedded Mode */}
      {!isFullScreen && (
        <View style={[styles.mapOverlayBadge, { backgroundColor: activeTheme.mapOverlayGlass, borderColor: activeTheme.borderDark }, onBack ? { top: 52 } : null]}>
          <View style={[styles.livePulseDot, isFinalApproach && styles.pulseDotRadar]} />
          <Text style={[styles.mapOverlayText, { color: activeTheme.textPrimary }]}>
            LIVE GPS • {targetName} • {latitude.toFixed(5)}, {longitude.toFixed(5)} (±{accuracy ? accuracy.toFixed(1) : '10'}m)
          </Text>
        </View>
      )}

      {/* 2. FINAL APPROACH RADAR SLIM MICRO-PILL BADGE (STACKED CLEANLY BELOW GPS BADGE) */}
      {isFinalApproach && (
        <View style={[
          styles.finalApproachPill,
          {
            backgroundColor: isDarkMode ? 'rgba(127, 29, 29, 0.88)' : 'rgba(254, 226, 226, 0.94)',
            borderColor: activeTheme.accentRed,
          },
          !isFullScreen ? { top: onBack ? 88 : 46 } : isFullScreen ? { top: 72 } : null
        ]}>
          <View style={[styles.radarPillDot, { backgroundColor: activeTheme.accentRed }]} />
          <Text style={[styles.radarPillText, { color: isDarkMode ? '#FFF' : '#991B1B' }]}>
            🎯 RADAR ACTIVE • {proximityDistance ? `${proximityDistance.toFixed(1)}m away` : '< 15m'}
          </Text>
        </View>
      )}

      {/* MapLibre Map View Container - Single Invariant Instance */}
      <Map
        style={styles.map}
        mapStyle={currentStyle}
        logo={false}
        attribution={false}
        androidView="texture"
        onPress={(e: any) => {
          // When in Geofence Editor Mode, map touch captures coordinates for center pin
          if (isEditorActive && e.geometry && e.geometry.type === 'Point') {
            const [lng, lat] = e.geometry.coordinates;
            setDraftCenter({ latitude: lat, longitude: lng });
          }
        }}
      >
        {/* CRITICAL: cameraRef attached directly to <Camera ref={cameraRef} />.
            initialViewState positions the camera correctly if coords are already
            available at mount. The useEffect above handles the case where GPS
            resolves after the component has already rendered. */}
        <Camera
          ref={cameraRef}
          initialViewState={{
            centerCoordinate: [longitude, latitude],
            zoomLevel: isFinalApproach ? 18.0 : 16.5,
          } as any}
        />

        {/* 4. USER LOCATION MARKER */}
        <UserLocation animated={true} />

        {/* 60 FPS Smooth Animated Target Location Marker Pin */}
        <SmoothAnimatedMarker
          id="target-device-smooth-pin"
          targetCoordinate={{ latitude, longitude, accuracy: accuracy || undefined }}
          durationMs={1500}
          title={targetName}
          markerColor={isFinalApproach ? activeTheme.mapRouteColorEmergency : activeTheme.mapRouteColor}
          showHeadingArrow={true}
          onPress={() => handleRecenter(18.0)}
        />

        {/* Historical Route Directional & Speed-Gradient Line Layer */}
        {logs.length > 0 && routeGeoJSON.features.length > 0 && (
          <GeoJSONSource id="route-source" data={routeGeoJSON}>
            {/* 1. Base Gradient Line */}
            <Layer
              id="route-line"
              type="line"
              paint={{
                'line-color': ['get', 'color'] as any,
                'line-width': 5,
                'line-opacity': 0.9,
              }}
              layout={{
                'line-cap': 'round',
                'line-join': 'round',
              }}
            />
            {/* 2. Directional Arrows Layer */}
            <Layer
              id="route-arrows"
              type="symbol"
              layout={{
                'symbol-placement': 'line',
                'symbol-spacing': 50,
                'text-field': '➤',
                'text-size': 16,
                'text-pitch-alignment': 'map',
                'text-rotation-alignment': 'map',
                'text-keep-upright': false,
              }}
              paint={{
                'text-color': '#FFFFFF',
                'text-halo-color': 'rgba(0,0,0,0.5)',
                'text-halo-width': 1,
              }}
            />
          </GeoJSONSource>
        )}

        {/* Active Safe Zones Geofence Circles - Theme-Aware Dynamic Color */}
        {safeZoneFeatures.length > 0 && (
          <GeoJSONSource id="safezones-source" data={safeZonesGeoJSON}>
            <Layer
              id="safezones-fill"
              type="fill"
              paint={{
                'fill-color': activeTheme.mapGeofenceFill,
                'fill-opacity': 0.25,
              }}
            />
            <Layer
              id="safezones-outline"
              type="line"
              paint={{
                'line-color': activeTheme.mapGeofenceOutline,
                'line-width': 2.5,
              }}
            />
          </GeoJSONSource>
        )}

        {/* 🟢 Real-Time Draft Geofence Preview Layer */}
        {isEditorActive && draftPolygonGeoJSON && (
          <GeoJSONSource id="draft-geofence-source" data={draftPolygonGeoJSON}>
            <Layer
              id="draft-geofence-fill"
              type="fill"
              paint={{
                'fill-color': '#10B981',
                'fill-opacity': 0.35,
              }}
            />
            <Layer
              id="draft-geofence-outline"
              type="line"
              paint={{
                'line-color': '#34D399',
                'line-width': 3,
                'line-dasharray': [2, 2],
              }}
            />
          </GeoJSONSource>
        )}

        {/* 🟢 Draft Center Marker Pin with Radius Badge */}
        {isEditorActive && draftCenter && (
          <Marker id="draft-center-pin" lngLat={[draftCenter.longitude, draftCenter.latitude]}>
            <View style={styles.draftPinWrapper}>
              <Text style={styles.draftPinIcon}>📍</Text>
              <View style={[styles.draftPinBadge, { backgroundColor: activeTheme.cardBg, borderColor: activeTheme.accentGreen }]}>
                <Text style={[styles.draftPinBadgeText, { color: activeTheme.textPrimary }]}>
                  {draftRadius}m
                </Text>
              </View>
            </View>
          </Marker>
        )}
      </Map>

      {/* Offline Tile Caching Status Toast */}
      {cacheProgress !== null && (
        <View style={[styles.cacheProgressBadge, { backgroundColor: activeTheme.mapOverlayGlass, borderColor: activeTheme.accentCyan }, isFullScreen ? { top: 80 } : null]}>
          <Text style={[styles.cacheProgressText, { color: activeTheme.textPrimary }]}>
            💾 Caching Map Tiles Offline... {cacheProgress}%
          </Text>
        </View>
      )}
      {isCached && cacheProgress === null && (
        <View style={[styles.cacheProgressBadge, { backgroundColor: activeTheme.accentGreenBg, borderColor: activeTheme.accentGreen }, isFullScreen ? { top: 80 } : null]}>
          <Text style={[styles.cacheProgressText, { color: isDarkMode ? '#FFF' : activeTheme.accentGreen }]}>✅ Offline Map Cached</Text>
        </View>
      )}

      {/* 🛡️ INTERACTIVE ON-MAP GEOFENCE VISUAL EDITOR BOTTOM SHEET */}
      {isEditorActive && (
        <View style={[styles.geofenceEditorCard, { backgroundColor: activeTheme.cardBgGlass, borderColor: activeTheme.borderDark }]}>
          <View style={styles.editorHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 18, marginRight: 8 }}>🛡️</Text>
              <Text style={[styles.editorTitle, { color: activeTheme.textPrimary }]}>Visual Safe Zone Editor</Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                setIsEditorActive(false);
                setDraftCenter(null);
                setDraftZoneName('');
              }}
            >
              <Text style={{ color: activeTheme.accentRed, fontWeight: '700', fontSize: 13 }}>✕ Cancel</Text>
            </TouchableOpacity>
          </View>

          <Text style={[styles.editorInstruction, { color: activeTheme.textSecondary }]}>
            {draftCenter
              ? `📍 Center: ${draftCenter.latitude.toFixed(5)}°, ${draftCenter.longitude.toFixed(5)}° (Tap map to move)`
              : '👉 Tap anywhere on map to set safe zone center'}
          </Text>

          {/* Safe Zone Name Input */}
          <TextInput
            style={[
              styles.editorTextInput,
              {
                backgroundColor: activeTheme.bgDark,
                color: activeTheme.textPrimary,
                borderColor: activeTheme.borderDark,
              },
            ]}
            placeholder="e.g. Home Perimeter, Campus, Office"
            placeholderTextColor={activeTheme.textMuted}
            value={draftZoneName}
            onChangeText={setDraftZoneName}
          />

          {/* Quick Radius Selection Chips */}
          <View style={styles.radiusContainer}>
            <Text style={[styles.radiusHeading, { color: activeTheme.textPrimary }]}>
              Perimeter Radius: <Text style={{ color: activeTheme.accentCyan, fontWeight: '800' }}>{draftRadius}m</Text>
            </Text>
            <View style={styles.radiusChipsRow}>
              {[100, 250, 500, 1000, 2000].map(r => (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.radiusChip,
                    { borderColor: activeTheme.borderDark },
                    draftRadius === r && {
                      backgroundColor: activeTheme.accentPrimary,
                      borderColor: activeTheme.accentPrimary,
                    },
                  ]}
                  onPress={() => setDraftRadius(r)}
                >
                  <Text
                    style={[
                      styles.radiusChipText,
                      { color: draftRadius === r ? '#FFF' : activeTheme.textSecondary },
                    ]}
                  >
                    {r >= 1000 ? `${r / 1000}km` : `${r}m`}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* Save & Activate Safe Zone Button */}
          <TouchableOpacity
            style={[
              styles.saveZoneBtn,
              {
                backgroundColor:
                  !draftCenter || !draftZoneName.trim()
                    ? activeTheme.borderDark
                    : activeTheme.accentGreen,
              },
            ]}
            disabled={!draftCenter || !draftZoneName.trim()}
            onPress={() => {
              if (!draftCenter) {
                Alert.alert('Location Required', 'Please tap on the map to set the safe zone center position.');
                return;
              }
              if (!draftZoneName.trim()) {
                Alert.alert('Name Required', 'Please enter a name for this Safe Zone.');
                return;
              }
              onCreateSafeZone?.(
                draftZoneName.trim(),
                draftRadius,
                draftCenter.latitude,
                draftCenter.longitude
              );
              setIsEditorActive(false);
              setDraftCenter(null);
              setDraftZoneName('');
            }}
          >
            <Text style={styles.saveZoneBtnText}>
              ✓ Save & Activate Safe Zone ({draftRadius}m)
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* FLOATING ACTION BUTTON CONTROLS (INCLUDES 🎯 MY LOCATION, 🛡️ + ZONE, & 🌙/☀️ THEME TOGGLE) */}
      {!isEditorActive && (
        isFullScreen ? (
          <View style={[styles.googleMapsBottomSheet, { backgroundColor: activeTheme.cardBgGlass, borderColor: activeTheme.borderDark }]}>
            <View style={[styles.bottomSheetHandle, { backgroundColor: activeTheme.borderDark }]} />
            <View style={styles.bottomSheetHeaderRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.bottomSheetTitle, { color: activeTheme.textPrimary }]}>{targetName}</Text>
                <Text style={[styles.bottomSheetCoords, { color: activeTheme.textSecondary }]}>
                  📍 {latitude.toFixed(5)}, {longitude.toFixed(5)} • ±{accuracy ? accuracy.toFixed(1) : '5'}m
                </Text>
              </View>
              <View style={[styles.bottomSheetBadge, { backgroundColor: activeTheme.accentGreenBg, borderColor: activeTheme.accentGreen }]}>
                <View style={[styles.livePulseDot, { backgroundColor: activeTheme.accentGreen }]} />
                <Text style={[styles.bottomSheetBadgeText, { color: isDarkMode ? '#FFF' : activeTheme.accentGreen }]}>LIVE GPS</Text>
              </View>
            </View>

            {/* Quick Action Button Row with Safe Zone Editor & Theme Toggle */}
            <View style={styles.bottomSheetActionRow}>
              {onOpenARView && (
                <TouchableOpacity style={[styles.bottomSheetBtn, { backgroundColor: activeTheme.accentRedBg, borderColor: activeTheme.accentRed }]} onPress={onOpenARView}>
                  <Text style={styles.bottomSheetBtnIcon}>📷</Text>
                  <Text style={[styles.bottomSheetBtnText, { color: isDarkMode ? '#FFF' : activeTheme.accentRed }]}>AR Vision</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.bottomSheetBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
                onPress={() => {
                  setIsEditorActive(true);
                  if (!draftCenter && latitude && longitude) {
                    setDraftCenter({ latitude, longitude });
                  }
                }}
              >
                <Text style={styles.bottomSheetBtnIcon}>🛡️</Text>
                <Text style={[styles.bottomSheetBtnText, { color: activeTheme.mapControlBtnText }]}>+ Safe Zone</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bottomSheetBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
                onPress={handleRecenter}
              >
                <Text style={styles.bottomSheetBtnIcon}>🎯</Text>
                <Text style={[styles.bottomSheetBtnText, { color: activeTheme.mapControlBtnText }]}>My Location</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bottomSheetBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
                onPress={handleToggleStyle}
              >
                <Text style={styles.bottomSheetBtnIcon}>{isDarkMode ? '🌙' : '☀️'}</Text>
                <Text style={[styles.bottomSheetBtnText, { color: activeTheme.mapControlBtnText }]}>{isDarkMode ? 'Dark' : 'Light'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.bottomSheetBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
                onPress={onOpenOfflineModal || handleOpenOfflineModal}
              >
                <Text style={styles.bottomSheetBtnIcon}>📥</Text>
                <Text style={[styles.bottomSheetBtnText, { color: activeTheme.mapControlBtnText }]}>Offline Pack</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Interactive Map Control Floating Action Buttons for Embedded Preview */
          <View style={styles.controlsContainer}>
            {onOpenARView && (
              <TouchableOpacity style={[styles.controlBtn, { backgroundColor: activeTheme.accentRedBg, borderColor: activeTheme.accentRed }]} onPress={onOpenARView}>
                <Text style={styles.controlBtnIcon}>📷</Text>
              </TouchableOpacity>
            )}
            {onExpandFullScreen && (
              <TouchableOpacity
                style={[styles.controlBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
                onPress={onExpandFullScreen}
              >
                <Text style={styles.controlBtnIcon}>⛶</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
              onPress={() => {
                setIsEditorActive(true);
                if (!draftCenter && latitude && longitude) {
                  setDraftCenter({ latitude, longitude });
                }
              }}
            >
              <Text style={styles.controlBtnIcon}>🛡️</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
              onPress={handleRecenter}
            >
              <Text style={styles.controlBtnIcon}>🎯</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
              onPress={handleToggleStyle}
            >
              <Text style={styles.controlBtnIcon}>{isDarkMode ? '🌙' : '☀️'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.controlBtn, { backgroundColor: activeTheme.mapControlBtnBg, borderColor: activeTheme.mapControlBtnBorder }]}
              onPress={() => {
                if (onOpenOfflineModal) {
                  onOpenOfflineModal();
                } else {
                  handleOpenOfflineModal();
                }
              }}
            >
              <Text style={styles.controlBtnIcon}>📥</Text>
            </TouchableOpacity>
          </View>
        )
      )}

      {/* OFFLINE VECTOR TILE PACK MANAGER MODAL (Section 5.2.3 / Figure 5.8) */}
      {isOfflineModalVisible && (
        <View style={styles.modalBackdrop}>
          <View style={[styles.offlineModalCard, { backgroundColor: activeTheme.cardBg, borderColor: activeTheme.borderDark }]}>
            {/* Modal Header */}
            <View style={styles.modalHeaderRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={styles.modalTitleIcon}>🗺️</Text>
                <View>
                  <Text style={[styles.modalTitleText, { color: activeTheme.textPrimary }]}>Offline Vector Tile Pack</Text>
                  <Text style={[styles.modalSubtitleText, { color: activeTheme.accentCyan }]}>MapLibre SQLite Storage Lifecycle</Text>
                </View>
              </View>
              <TouchableOpacity
                style={[styles.modalCloseBtn, { backgroundColor: activeTheme.borderDark }]}
                onPress={() => setIsOfflineModalVisible(false)}
              >
                <Text style={[styles.modalCloseBtnText, { color: activeTheme.textPrimary }]}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Pack Metadata Grid */}
            <View style={[styles.packMetadataContainer, { backgroundColor: activeTheme.bgDark, borderColor: activeTheme.borderDark }]}>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Pack Identifier:</Text>
                <Text style={[styles.metaValue, { color: activeTheme.accentCyan }]}>Liberty-Colombo-Bounds</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Center Coordinates:</Text>
                <Text style={[styles.metaValue, { color: activeTheme.textPrimary }]}>
                  {(latitude || 6.9271).toFixed(4)}° N, {(longitude || 79.8612).toFixed(4)}° E
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Bounding Scope:</Text>
                <Text style={[styles.metaValue, { color: activeTheme.textPrimary }]}>~2.2km Radius (City Metropolitan)</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Vector Style Source:</Text>
                <Text style={[styles.metaValue, { color: activeTheme.textSecondary }]} numberOfLines={1}>
                  OpenFreeMap Liberty (Vector GL)
                </Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Zoom Level Range:</Text>
                <Text style={[styles.metaValue, { color: activeTheme.textPrimary }]}>Zoom 10 to Zoom 18 (Street Precision)</Text>
              </View>
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Storage Target:</Text>
                <Text style={[styles.metaValue, { color: activeTheme.accentGreen }]}>
                  Local SQLite Cache (mbgl-offline.db)
                </Text>
              </View>
            </View>

            {/* Live Progress & Status Box */}
            <View style={[styles.progressBox, { backgroundColor: activeTheme.bgDark, borderColor: activeTheme.borderDark }]}>
              <View style={styles.progressHeaderRow}>
                <Text style={[styles.progressHeaderLabel, { color: activeTheme.textSecondary }]}>Lifecycle Status</Text>
                <Text style={[styles.progressPercentText, { color: isCached ? activeTheme.accentGreen : activeTheme.accentCyan }]}>
                  {cacheProgress !== null ? `${cacheProgress}%` : (isCached ? '100%' : 'Idle')}
                </Text>
              </View>

              {/* Progress Bar Track */}
              <View style={[styles.progressBarTrack, { backgroundColor: activeTheme.borderDark }]}>
                <View
                  style={[
                    styles.progressBarFill,
                    {
                      width: `${cacheProgress !== null ? cacheProgress : (isCached ? 100 : 0)}%`,
                      backgroundColor: isCached ? activeTheme.accentGreen : activeTheme.accentCyan,
                    },
                  ]}
                />
              </View>

              {/* Status Message Text matching Thesis Figure 5.8 */}
              <View style={styles.statusCalloutRow}>
                <Text style={styles.statusCalloutIcon}>
                  {isDownloadingPack ? '⏳' : (isCached ? '✅' : 'ℹ️')}
                </Text>
                <Text style={[styles.statusCalloutText, { color: isCached ? '#10B981' : activeTheme.textSecondary }]}>
                  {isDownloadingPack
                    ? `Caching vector tiles to SQLite... ${cacheProgress || 0}%`
                    : isCached
                    ? "Stored in local SQLite cache. Offline mode active."
                    : "Pack ready to cache for zero-data GPS fallback."}
                </Text>
              </View>
            </View>

            {/* Action Buttons */}
            <View style={styles.modalActionRow}>
              <TouchableOpacity
                style={[
                  styles.downloadPackBtn,
                  { backgroundColor: isDownloadingPack ? activeTheme.borderDark : activeTheme.accentGreen },
                ]}
                onPress={handleStartPackDownload}
                disabled={isDownloadingPack}
                activeOpacity={0.8}
              >
                <Text style={styles.downloadPackBtnText}>
                  {isDownloadingPack ? '⏳ Downloading...' : (isCached ? '🔄 Re-download Pack' : '📥 Download & Cache Region')}
                </Text>
              </TouchableOpacity>

              {isCached && (
                <TouchableOpacity
                  style={[styles.deletePackBtn, { backgroundColor: activeTheme.accentRedBg, borderColor: activeTheme.accentRed }]}
                  onPress={handleDeleteOfflinePack}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.deletePackBtnText, { color: activeTheme.accentRed }]}>🗑️ Delete Pack</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    marginVertical: 16,
    position: 'relative',
  },
  fullScreenContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    position: 'relative',
  },
  map: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  placeholderContainer: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    marginVertical: 16,
  },
  placeholderIcon: {
    fontSize: 42,
    marginBottom: 12,
  },
  placeholderTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  placeholderSubtitle: {
    fontSize: 12,
    textAlign: 'center',
  },
  mapOverlayBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    zIndex: 10,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  livePulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
    marginRight: 8,
  },
  pulseDotRadar: {
    backgroundColor: '#EF4444',
  },
  mapOverlayText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  controlsContainer: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    flexDirection: 'column',
    zIndex: 10,
  },
  controlBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    borderWidth: 1,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  controlBtnIcon: {
    fontSize: 18,
  },
  finalApproachPill: {
    position: 'absolute',
    top: 10,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    zIndex: 90,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  radarPillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  radarPillText: {
    fontSize: 11,
    fontWeight: '800',
  },
  cacheProgressBadge: {
    position: 'absolute',
    top: 50,
    alignSelf: 'center',
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    zIndex: 15,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  cacheProgressText: {
    fontSize: 11,
    fontWeight: '700',
  },
  backFloatingBtn: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    zIndex: 99,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  backFloatingBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  googleMapsTopBar: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 10 : 12,
    left: 12,
    right: 12,
    zIndex: 99,
    flexDirection: 'row',
    alignItems: 'center',
  },
  googleMapsBackBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    marginRight: 10,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  googleMapsBackBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  googleMapsTitleBox: {
    flex: 1,
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderWidth: 1,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  googleMapsTitleText: {
    fontSize: 14,
    fontWeight: '800',
  },
  googleMapsSubtitleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  googleMapsBottomSheet: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    zIndex: 99,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  bottomSheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  bottomSheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  bottomSheetTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  bottomSheetCoords: {
    fontSize: 12,
    marginTop: 2,
  },
  bottomSheetBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  bottomSheetBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  bottomSheetActionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  bottomSheetBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
  },
  bottomSheetBtnIcon: {
    fontSize: 18,
    marginBottom: 2,
  },
  bottomSheetBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  // Draft Center Pin Marker Styles
  draftPinWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  draftPinIcon: {
    fontSize: 28,
  },
  draftPinBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: -4,
    elevation: 4,
  },
  draftPinBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  // Geofence Editor Floating Sheet Card Styles
  geofenceEditorCard: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    zIndex: 100,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  editorHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  editorTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  editorInstruction: {
    fontSize: 11,
    marginBottom: 10,
    fontWeight: '500',
  },
  editorTextInput: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    borderWidth: 1,
    marginBottom: 10,
  },
  radiusContainer: {
    marginBottom: 12,
  },
  radiusHeading: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  radiusChipsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  radiusChip: {
    flex: 1,
    paddingVertical: 6,
    marginHorizontal: 2,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  radiusChipText: {
    fontSize: 11,
    fontWeight: '700',
  },
  saveZoneBtn: {
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  saveZoneBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  /* Offline Vector Tile Pack Modal Styles (Section 5.2.3 / Figure 5.8) */
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 9999,
    elevation: 30,
  },
  offlineModalCard: {
    width: '100%',
    maxWidth: 440,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  modalTitleIcon: {
    fontSize: 26,
    marginRight: 10,
  },
  modalTitleText: {
    fontSize: 16,
    fontWeight: '800',
  },
  modalSubtitleText: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalCloseBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  packMetadataContainer: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  metaLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  metaValue: {
    fontSize: 11,
    fontWeight: '700',
    maxWidth: '55%',
    textAlign: 'right',
  },
  progressBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  progressHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  progressHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  progressPercentText: {
    fontSize: 13,
    fontWeight: '800',
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  statusCalloutRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusCalloutIcon: {
    fontSize: 14,
    marginRight: 6,
  },
  statusCalloutText: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  modalActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  downloadPackBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  downloadPackBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  deletePackBtn: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deletePackBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
