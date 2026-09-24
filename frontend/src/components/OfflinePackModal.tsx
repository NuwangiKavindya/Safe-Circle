import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { offlineMapService } from '../services/offlineMapService';
import { useTheme } from '../context/ThemeContext';
import { THEME_PALETTES } from '../styles/theme';

interface OfflinePackModalProps {
  visible: boolean;
  latitude?: number | null;
  longitude?: number | null;
  onClose: () => void;
}

export const OfflinePackModal: React.FC<OfflinePackModalProps> = ({
  visible,
  latitude,
  longitude,
  onClose,
}) => {
  const { isDark } = useTheme();
  const theme = isDark ? THEME_PALETTES.dark : THEME_PALETTES.light;

  const [cacheProgress, setCacheProgress] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [isCached, setIsCached] = useState<boolean>(false);

  const packName = 'Liberty-Colombo-Bounds';
  const targetLat = latitude || 6.9271;
  const targetLng = longitude || 79.8612;

  // Check if pack is already cached on mount/open
  useEffect(() => {
    if (visible) {
      offlineMapService.getCachedPacks().then((packs: any[]) => {
        const found = packs && packs.some((p: any) => p?.name === packName);
        if (found) {
          setIsCached(true);
          setCacheProgress(100);
        }
      }).catch(() => {});
    }
  }, [visible]);

  if (!visible) return null;

  const handleStartDownload = async () => {
    setIsDownloading(true);
    setCacheProgress(0);

    const success = await offlineMapService.cacheRegion(
      {
        packName,
        latitude: targetLat,
        longitude: targetLng,
        mapStyle: isDark
          ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
          : 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      },
      (progress: number) => {
        setCacheProgress(progress);
      }
    );

    setIsDownloading(false);
    if (success) {
      setIsCached(true);
      setCacheProgress(100);
    } else {
      setCacheProgress(null);
    }
  };

  const handleDeletePack = async () => {
    await offlineMapService.deleteCachedPack(packName);
    setIsCached(false);
    setCacheProgress(null);
  };

  return (
    <View style={styles.modalOverlay}>
      <View style={[styles.modalCard, { backgroundColor: theme.cardBg, borderColor: theme.borderDark }]}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Text style={styles.headerIcon}>🗺️</Text>
            <View style={{ flex: 1 }}>
              <Text style={[styles.headerTitle, { color: theme.textPrimary }]}>Offline Vector Tile Pack</Text>
              <Text style={[styles.headerSubtitle, { color: theme.accentCyan }]}>
                MapLibre SQLite Storage Lifecycle (Sec 5.2.3)
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={[styles.closeBtn, { backgroundColor: theme.borderDark }]}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Text style={[styles.closeBtnText, { color: theme.textPrimary }]}>✕</Text>
          </TouchableOpacity>
        </View>

        {/* Technical Metadata Table */}
        <View style={[styles.metadataContainer, { backgroundColor: theme.bgDark, borderColor: theme.borderDark }]}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Pack Identifier:</Text>
            <Text style={[styles.metaValue, { color: theme.accentCyan }]}>{packName}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Center Coordinates:</Text>
            <Text style={[styles.metaValue, { color: theme.textPrimary }]}>
              {targetLat.toFixed(4)}° N, {targetLng.toFixed(4)}° E
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Coverage Scope:</Text>
            <Text style={[styles.metaValue, { color: theme.textPrimary }]}>~2.2km Radius (Metropolitan)</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Vector Protocol:</Text>
            <Text style={[styles.metaValue, { color: theme.textSecondary }]} numberOfLines={1}>
              OpenFreeMap Liberty / Carto GL
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Zoom Level Range:</Text>
            <Text style={[styles.metaValue, { color: theme.textPrimary }]}>Zoom 10 - Zoom 18 (Street Precision)</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Storage Target:</Text>
            <Text style={[styles.metaValue, { color: theme.accentGreen }]}>
              Local SQLite Cache (mbgl-offline.db)
            </Text>
          </View>
        </View>

        {/* Progress & Lifecycle Confirmation */}
        <View style={[styles.lifecycleBox, { backgroundColor: theme.bgDark, borderColor: theme.borderDark }]}>
          <View style={styles.lifecycleHeader}>
            <Text style={[styles.lifecycleLabel, { color: theme.textSecondary }]}>LIFECYCLE STATUS</Text>
            <Text style={[styles.lifecyclePercent, { color: isCached ? theme.accentGreen : theme.accentCyan }]}>
              {cacheProgress !== null ? `${cacheProgress}%` : (isCached ? '100%' : '0%')}
            </Text>
          </View>

          {/* Progress Bar Track */}
          <View style={[styles.progressBarTrack, { backgroundColor: theme.borderDark }]}>
            <View
              style={[
                styles.progressBarFill,
                {
                  width: `${cacheProgress !== null ? cacheProgress : (isCached ? 100 : 0)}%`,
                  backgroundColor: isCached ? theme.accentGreen : theme.accentCyan,
                },
              ]}
            />
          </View>

          {/* Status Message Text matching Thesis Figure 5.8 verbatim */}
          <View style={styles.statusTextRow}>
            {isDownloading ? (
              <ActivityIndicator size="small" color={theme.accentCyan} style={{ marginRight: 8 }} />
            ) : (
              <Text style={styles.statusIcon}>{isCached ? '✅' : 'ℹ️'}</Text>
            )}
            <Text style={[styles.statusMessage, { color: isCached ? '#10B981' : theme.textSecondary }]}>
              {isDownloading
                ? `Caching vector tiles to SQLite... ${cacheProgress || 0}%`
                : isCached
                ? 'Stored in local SQLite cache. Offline mode active.'
                : 'Ready to pre-cache vector map tiles for offline GPS safety.'}
            </Text>
          </View>
        </View>

        {/* Actions */}
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.downloadBtn,
              { backgroundColor: isDownloading ? theme.borderDark : theme.accentGreen },
            ]}
            onPress={handleStartDownload}
            disabled={isDownloading}
            activeOpacity={0.8}
          >
            <Text style={styles.downloadBtnText}>
              {isDownloading ? '⏳ Downloading Tiles...' : (isCached ? '🔄 Re-download Pack' : '📥 Download & Cache Region')}
            </Text>
          </TouchableOpacity>

          {isCached && (
            <TouchableOpacity
              style={[styles.deleteBtn, { backgroundColor: theme.accentRedBg, borderColor: theme.accentRed }]}
              onPress={handleDeletePack}
              activeOpacity={0.8}
            >
              <Text style={[styles.deleteBtnText, { color: theme.accentRed }]}>🗑️ Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    zIndex: 99999,
    elevation: 40,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 20,
    elevation: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  headerIcon: {
    fontSize: 26,
    marginRight: 12,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeBtnText: {
    fontSize: 14,
    fontWeight: '800',
  },
  metadataContainer: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
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
  lifecycleBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 16,
  },
  lifecycleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  lifecycleLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  lifecyclePercent: {
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
  statusTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIcon: {
    fontSize: 14,
    marginRight: 8,
  },
  statusMessage: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
    lineHeight: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
  },
  downloadBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  downloadBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '800',
  },
  deleteBtn: {
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
