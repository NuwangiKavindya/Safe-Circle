import { OfflineManager, OfflinePack, OfflinePackStatus } from '@maplibre/maplibre-react-native';

export interface CacheRegionOptions {
  packName: string;
  latitude: number;
  longitude: number;
  mapStyle?: string;
  minZoom?: number;
  maxZoom?: number;
}

class OfflineMapService {
  /**
   * Caches a region's vector map tiles around specified coordinates for offline recovery
   */
  async cacheRegion(
    options: CacheRegionOptions,
    onProgress?: (progressPercent: number) => void
  ): Promise<boolean> {
    const {
      packName,
      latitude,
      longitude,
      mapStyle = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      minZoom = 12,
      maxZoom = 18,
    } = options;

    // Define 0.02 degree bounding box around center coordinates (~2.2km radius)
    const delta = 0.02;
    const bounds: [number, number, number, number] = [
      longitude - delta, // west (swLng)
      latitude - delta,  // south (swLat)
      longitude + delta, // east (neLng)
      latitude + delta,  // north (neLat)
    ];

    try {
      console.log(`[OfflineMapService] Starting map tile caching for pack: ${packName}`);

      const progressListener = (_pack: OfflinePack, status: OfflinePackStatus) => {
        const percentage = Math.round(status.percentage);
        console.log(`[OfflineMapService] Tile cache progress: ${percentage}%`);
        if (percentage >= 100 || status.state === 'complete') {
          console.log(`[OfflineMapService] Pack '${packName}' status: 100% complete`);
          console.log(`[OfflineMapService] Stored in local SQLite cache. Offline mode active.`);
        }
        if (onProgress) {
          onProgress(percentage);
        }
      };

      const errorListener = (_pack: OfflinePack, error: any) => {
        console.log('[OfflineMapService] Error caching tiles:', error);
      };

      await OfflineManager.createPack(
        {
          mapStyle,
          bounds,
          minZoom,
          maxZoom,
          metadata: { name: packName },
        },
        progressListener,
        errorListener
      );

      return true;
    } catch (err) {
      console.log('[OfflineMapService] Failed to create offline map pack:', err);
      return false;
    }
  }

  /**
   * Retrieves all cached offline map packs
   */
  async getCachedPacks() {
    try {
      return await OfflineManager.getPacks();
    } catch (err) {
      console.log('[OfflineMapService] Failed to retrieve offline packs:', err);
      return [];
    }
  }

  /**
   * Removes a cached offline pack by name
   */
  async deleteCachedPack(packName: string): Promise<boolean> {
    try {
      await OfflineManager.deletePack(packName);
      console.log(`[OfflineMapService] Offline pack deleted: ${packName}`);
      return true;
    } catch (err) {
      console.log('[OfflineMapService] Failed to delete offline pack:', err);
      return false;
    }
  }
}

export const offlineMapService = new OfflineMapService();

/**
 * Direct reference export for Thesis Section 5.2.3: Module 3 MapLibre Offline Vector Tile Pack Caching
 */
export const downloadOfflineRegion = async (
  packName: string = 'Liberty-Colombo-Bounds',
  bounds?: [[number, number], [number, number]] | [number, number, number, number]
) => {
  return offlineMapService.cacheRegion({
    packName,
    latitude: 6.9271, // Colombo latitude
    longitude: 79.8612, // Colombo longitude
    mapStyle: 'https://tiles.openfreemap.org/styles/liberty',
    minZoom: 10,
    maxZoom: 16,
  });
};
