import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { MapViewComponent } from '../components/MapViewComponent';
import { SafeZone } from '../services/api';
import { LocationCoordinates } from '../services/locationService';
import { ApiAlert } from '../types';
import { COLORS, globalStyles } from '../styles/theme';
import { soundService } from '../services/soundService';

interface TacticalSplitMapScreenProps {
  liveLocation?: LocationCoordinates | null;
  safeZones?: SafeZone[];
  activeAlert?: ApiAlert | null;
  isMotionGuardActive?: boolean;
  onBack: () => void;
  onRecenter?: () => void;
  onTriggerSos?: () => void;
  onToggleMotionGuard?: (active: boolean) => void;
  onNavigateARView?: () => void;
  onCreateSafeZone?: (zoneName: string, radiusMeters: number, latitude?: number, longitude?: number) => void;
  onOpenOfflineModal?: () => void;
}

export const TacticalSplitMapScreen: React.FC<TacticalSplitMapScreenProps> = ({
  liveLocation,
  safeZones = [],
  activeAlert,
  isMotionGuardActive = false,
  onBack,
  onRecenter,
  onTriggerSos,
  onToggleMotionGuard,
  onNavigateARView,
  onCreateSafeZone,
  onOpenOfflineModal,
}) => {
  const [activeTab, setActiveTab] = useState<'telemetry' | 'controls' | 'history'>('telemetry');
  const [isSirenTesting, setIsSirenTesting] = useState(false);

  const lat = liveLocation?.latitude || 6.9271;
  const lng = liveLocation?.longitude || 79.8612;
  const accuracy = liveLocation?.accuracy || 3.5;
  const speedKmh = ((liveLocation?.speed || 0) * 3.6).toFixed(1);
  const headingDeg = Math.round(liveLocation?.heading || 0);

  const handleToggleSirenTest = () => {
    if (isSirenTesting) {
      soundService.stopSound();
      setIsSirenTesting(false);
    } else {
      soundService.playSound('police_siren');
      setIsSirenTesting(true);
    }
  };

  return (
    <View style={styles.container}>
      {/* Location Header Bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backBtnText}>◀ Back</Text>
        </TouchableOpacity>
        <View style={styles.headerTitleCol}>
          <Text style={styles.headerTitleText}>Tactical Map Viewport</Text>
          <Text style={styles.headerSubText}>
            📍 {lat.toFixed(4)}° N, {lng.toFixed(4)}° E
          </Text>
        </View>
        <View style={styles.liveGpsBadge}>
          <View style={styles.liveGpsDot} />
          <Text style={styles.liveGpsText}>60 FPS</Text>
        </View>
      </View>

      {/* Top 60% Map Viewport Section */}
      <View style={styles.mapContainer}>
        <MapViewComponent
          latitude={lat}
          longitude={lng}
          accuracy={accuracy}
          safeZones={safeZones}
          onOpenARView={onNavigateARView}
          onCreateSafeZone={onCreateSafeZone}
          onOpenOfflineModal={onOpenOfflineModal}
        />
      </View>


      {/* Bottom 40% Glassmorphism Control & Telemetry Drawer */}
      <View style={styles.drawerContainer}>
        {/* Tab Selection Navigation Header */}
        <View style={styles.tabHeader}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'telemetry' && styles.tabBtnActive]}
            onPress={() => setActiveTab('telemetry')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'telemetry' && styles.tabBtnTextActive]}>
              📊 Telemetry
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'controls' && styles.tabBtnActive]}
            onPress={() => setActiveTab('controls')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'controls' && styles.tabBtnTextActive]}>
              ⚙️ Security
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabBtn, activeTab === 'history' && styles.tabBtnActive]}
            onPress={() => setActiveTab('history')}
          >
            <Text style={[styles.tabBtnText, activeTab === 'history' && styles.tabBtnTextActive]}>
              📜 Trajectory
            </Text>
          </TouchableOpacity>
        </View>

        {/* Tab Body Content */}
        <ScrollView style={styles.drawerBody} contentContainerStyle={{ paddingBottom: 24 }}>
          {activeTab === 'telemetry' && (
            <View style={styles.tabContent}>
              <View style={styles.telemetryGrid}>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Latitude / Longitude</Text>
                  <Text style={styles.statValue}>{lat.toFixed(5)}°, {lng.toFixed(5)}°</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Accuracy Radius</Text>
                  <Text style={[styles.statValue, { color: COLORS.accentGreen }]}>±{accuracy.toFixed(1)} meters</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Movement Speed</Text>
                  <Text style={[styles.statValue, { color: COLORS.accentCyan }]}>{speedKmh} km/h</Text>
                </View>
                <View style={styles.statBox}>
                  <Text style={styles.statLabel}>Compass Heading</Text>
                  <Text style={styles.statValue}>{headingDeg}° (Deg)</Text>
                </View>
              </View>

              <View style={styles.statusRow}>
                <Text style={styles.statusLabel}>Geofence Safe Zones:</Text>
                <Text style={styles.statusValText}>{safeZones.length} Active Radius Boundaries</Text>
              </View>
            </View>
          )}

          {activeTab === 'controls' && (
            <View style={styles.tabContent}>
              <View style={styles.actionsRow}>
                {onTriggerSos && (
                  <TouchableOpacity
                    style={[styles.actionCard, { backgroundColor: COLORS.accentRedBg, borderColor: COLORS.accentRed }]}
                    onPress={onTriggerSos}
                  >
                    <Text style={{ fontSize: 24, marginBottom: 4 }}>🚨</Text>
                    <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>Trigger SOS</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={[styles.actionCard, isSirenTesting ? styles.actionCardAlert : styles.actionCardNormal]}
                  onPress={handleToggleSirenTest}
                >
                  <Text style={{ fontSize: 24, marginBottom: 4 }}>{isSirenTesting ? '⏹️' : '🔔'}</Text>
                  <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>
                    {isSirenTesting ? 'Stop Siren' : 'Test 100% Siren'}
                  </Text>
                </TouchableOpacity>

                {onToggleMotionGuard && (
                  <TouchableOpacity
                    style={[styles.actionCard, isMotionGuardActive ? styles.actionCardActive : styles.actionCardNormal]}
                    onPress={() => onToggleMotionGuard(!isMotionGuardActive)}
                  >
                    <Text style={{ fontSize: 24, marginBottom: 4 }}>🛡️</Text>
                    <Text style={{ color: '#FFF', fontWeight: '800', fontSize: 13 }}>
                      {isMotionGuardActive ? 'Guard ON' : 'Guard OFF'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {activeTab === 'history' && (
            <View style={styles.tabContent}>
              <Text style={{ color: COLORS.textSecondary, fontSize: 13, marginBottom: 10 }}>
                Recent Real-Time Coordinates Trajectory:
              </Text>
              <View style={styles.historyRow}>
                <Text style={{ color: COLORS.accentGreen, fontWeight: '700', fontSize: 12 }}>● LIVE NOW</Text>
                <Text style={{ color: COLORS.textPrimary, fontSize: 12 }}>{lat.toFixed(5)}°, {lng.toFixed(5)}°</Text>
                <Text style={{ color: COLORS.textMuted, fontSize: 11 }}>Just now</Text>
              </View>
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgDark,
  },
  headerBar: {
    height: 60,
    backgroundColor: COLORS.cardBg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
  },
  backBtn: {
    backgroundColor: COLORS.borderDark,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  backBtnText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  headerTitleCol: {
    alignItems: 'center',
  },
  headerTitleText: {
    color: COLORS.textPrimary,
    fontSize: 15,
    fontWeight: '800',
  },
  headerSubText: {
    color: COLORS.accentCyan,
    fontSize: 11,
    fontWeight: '600',
  },
  liveGpsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  liveGpsDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
    marginRight: 6,
  },
  liveGpsText: {
    color: '#6EE7B7',
    fontSize: 10,
    fontWeight: '800',
  },
  mapContainer: {
    flex: 6, // 60% Map Height
  },
  drawerContainer: {
    flex: 4, // 40% Drawer Height
    backgroundColor: COLORS.cardBg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
  tabHeader: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderDark,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: COLORS.accentCyan,
    backgroundColor: COLORS.indigoBg,
  },
  tabBtnText: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  tabBtnTextActive: {
    color: COLORS.accentCyan,
  },
  drawerBody: {
    padding: 16,
  },
  tabContent: {},
  telemetryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statBox: {
    width: '48%',
    backgroundColor: COLORS.bgDark,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
  statLabel: {
    color: COLORS.textSecondary,
    fontSize: 11,
    marginBottom: 4,
  },
  statValue: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '800',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.bgDark,
    borderRadius: 10,
    padding: 12,
    marginTop: 4,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
  statusLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
  },
  statusValText: {
    color: COLORS.accentCyan,
    fontSize: 12,
    fontWeight: '700',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionCard: {
    flex: 1,
    marginHorizontal: 4,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
  },
  actionCardNormal: {
    backgroundColor: COLORS.indigoBg,
    borderColor: COLORS.indigoBorder,
  },
  actionCardAlert: {
    backgroundColor: COLORS.accentRedBg,
    borderColor: COLORS.accentRed,
  },
  actionCardActive: {
    backgroundColor: COLORS.accentGreenBg,
    borderColor: COLORS.accentGreen,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.bgDark,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: COLORS.borderDark,
  },
});
