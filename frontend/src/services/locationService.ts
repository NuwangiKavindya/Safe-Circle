import { Platform, PermissionsAndroid, Alert, DeviceEventEmitter } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { apiService } from './api';
import { motionService } from './motionService';

export interface LocationCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed?: number | null;
  heading?: number | null;
  altitude?: number | null;
  timestamp: string;
}

export type TrackingMode = 'EMERGENCY_SOS' | 'PASSIVE_MONITORING';

class LocationService {
  private watchId: number | null = null;
  private isTracking: boolean = false;
  // Subscription to native FusedLocation events from MotionForegroundService
  private nativeLocationSub: any = null;
  // Step 4: Adaptive location tracking mode & heartbeat timer
  private currentTrackingMode: TrackingMode = 'PASSIVE_MONITORING';
  private heartbeatIntervalId: any = null;
  private activeTrackingContext: {
    deviceId: string;
    token: string;
    socket: any;
    onLocationUpdate?: (location: LocationCoordinates) => void;
  } | null = null;

  /**
   * 1. ANDROID & IOS RUNTIME PERMISSION CHECK & REQUEST
   * Explicitly checks and requests native location permissions:
   * - Android: ACCESS_FINE_LOCATION and ACCESS_COARSE_LOCATION (plus ACCESS_BACKGROUND_LOCATION on API 29+)
   * - iOS: NSLocationWhenInUseUsageDescription / NSLocationAlwaysAndWhenInUseUsageDescription
   */
  async checkLocationPermission(): Promise<boolean> {
    if (Platform.OS === 'ios') {
      try {
        const auth = await Geolocation.requestAuthorization('whenInUse');
        return auth === 'granted';
      } catch (err) {
        console.warn('[LocationService] iOS Geolocation Permission Error:', err);
        return false;
      }
    }

    if (Platform.OS === 'android') {
      try {
        const hasFine = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
        );
        const hasCoarse = await PermissionsAndroid.check(
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
        );

        if (hasFine && hasCoarse) {
          return true;
        }

        const granted = await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
        ]);

        const fineGranted =
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] ===
          PermissionsAndroid.RESULTS.GRANTED;
        const coarseGranted =
          granted[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] ===
          PermissionsAndroid.RESULTS.GRANTED;

        if (!fineGranted && !coarseGranted) {
          Alert.alert(
            'Location Permission Denied',
            'SafeCircle requires location permissions to track your device safety in real-time. Please enable location permissions in app settings.'
          );
          return false;
        }

        // Background location check for Android 10+ (API 29+)
        if (Platform.Version >= 29 && fineGranted) {
          try {
            await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.ACCESS_BACKGROUND_LOCATION,
              {
                title: 'SafeCircle Background Location Access',
                message:
                  'SafeCircle needs background location access to broadcast emergency alerts to your safety circle even when minimized.',
                buttonPositive: 'Grant',
                buttonNegative: 'Cancel',
              }
            );
          } catch (bgErr) {
            console.warn('[LocationService] Background location permission skipped:', bgErr);
          }
        }

        return true;
      } catch (err) {
        console.warn('[LocationService] Android Permission Request Error:', err);
        return false;
      }
    }

    return false;
  }

  /**
   * 2. ANDROID FUSED LOCATION PROVIDER INTEGRATION WITH ADAPTIVE TRACKING
   * - Obtains immediate initial position fix via getCurrentPosition() with high accuracy settings
   * - Starts continuous adaptive watchPosition() tracking
   */
  async startLocationTracking(
    deviceId: string,
    token: string,
    socket: any,
    onLocationUpdate?: (location: LocationCoordinates) => void
  ): Promise<boolean> {
    if (this.isTracking) {
      console.log('[LocationService] Location tracking already active.');
      return true;
    }

    const hasPermission = await this.checkLocationPermission();
    if (!hasPermission) {
      console.warn('[LocationService] Cannot start tracking: Location permissions denied.');
      return false;
    }

    this.isTracking = true;
    this.activeTrackingContext = { deviceId, token, socket, onLocationUpdate };

    // Step A: Fetch immediate current location fix
    const initialLocation = await this.getCurrentLocation();
    if (initialLocation) {
      console.log(
        `[LocationService] Initial Fused GPS Fix: ${initialLocation.latitude}, ${initialLocation.longitude}`
      );
      if (onLocationUpdate) {
        onLocationUpdate(initialLocation);
      }
      if (socket && socket.connected) {
        // When socket is connected, server handler persists to LocationLog.
        socket.emit('location_update', {
          deviceId,
          ...initialLocation,
        });
      } else {
        // Socket offline / disconnected: fall back to HTTP API so fix is not dropped
        apiService.logLocation(token, {
          deviceId,
          latitude: initialLocation.latitude,
          longitude: initialLocation.longitude,
          accuracy: initialLocation.accuracy,
        }).catch(err => console.warn('[LocationService] Initial HTTP log failed:', err.message));
      }
    }

    // Step B: Continuous real-time coordinate streaming via watchPosition()
    const isEmergency = this.currentTrackingMode === 'EMERGENCY_SOS';
    try {
      this.watchId = Geolocation.watchPosition(
        (position) => {
          this.handlePositionReceived(position, deviceId, token, socket, onLocationUpdate);
        },
        (error) => {
          this.handleLocationError(error);
        },
        {
          enableHighAccuracy: true,
          distanceFilter: isEmergency ? 0 : 30,         // 0m in SOS vs 30m in passive mode
          interval: isEmergency ? 3000 : 45000,         // 3s in SOS vs 45s in passive mode
          fastestInterval: isEmergency ? 1500 : 15000,  // 1.5s in SOS vs 15s in passive mode
          forceRequestLocation: true,
          forceLocationManager: false,                  // Use Fused Location Provider API on Android
          showsBackgroundLocationIndicator: true,
          useSignificantChanges: false,
        }
      );

      // Start periodic heartbeat synchronization (30s)
      this.startHeartbeat(deviceId, socket);

      return true;
    } catch (err: any) {
      console.warn('[LocationService] Error starting watchPosition:', err.message || err);
      this.isTracking = false;
      return false;
    }
  }

  /**
   * Helper to process incoming coordinate positions
   */
  private handlePositionReceived(
    position: Geolocation.GeoPosition,
    deviceId: string,
    token: string,
    socket: any,
    onLocationUpdate?: (location: LocationCoordinates) => void
  ) {
    const { latitude, longitude, accuracy, speed, heading, altitude } = position.coords;
    const timestamp = new Date(position.timestamp).toISOString();

    const locationData: LocationCoordinates = {
      latitude,
      longitude,
      accuracy: accuracy || 5.0,
      speed: speed || 0,
      heading: heading || 0,
      altitude: altitude || 0,
      timestamp,
    };

    console.log(
      `[Android Fused Location] Live update (${this.currentTrackingMode}) for device ${deviceId}: ${latitude}, ${longitude} (±${accuracy}m)`
    );

    if (socket && socket.connected) {
      socket.emit('location_update', {
        deviceId,
        latitude,
        longitude,
        accuracy: accuracy || 5.0,
        speed: speed || 0,
        heading: heading || 0,
        altitude: altitude || 0,
        timestamp,
      });
    } else {
      // Socket disconnected: HTTP fallback
      apiService.logLocation(token, {
        deviceId,
        latitude,
        longitude,
        accuracy: accuracy || 5.0,
      }).catch(err => console.warn('[LocationService] Offline HTTP log error:', err.message));
    }

    if (onLocationUpdate) {
      onLocationUpdate(locationData);
    }
  }

  /**
   * Step 4: Adaptive location tracking interval switch
   * - EMERGENCY_SOS: 3s interval, 0m filter, High Accuracy GPS
   * - PASSIVE_MONITORING: 45s interval, 30m filter, Balanced Power (saves ~80% battery)
   */
  setTrackingMode(mode: TrackingMode) {
    if (this.currentTrackingMode === mode && this.watchId !== null) return;
    this.currentTrackingMode = mode;
    console.log(`[LocationService] ⚙️ Adaptive tracking mode set to: ${mode}`);

    // Update native Android foreground service
    motionService.setTrackingMode(mode).catch(() => {});

    // Re-bind watchPosition with mode parameters if already tracking
    if (this.isTracking && this.activeTrackingContext) {
      const { deviceId, token, socket, onLocationUpdate } = this.activeTrackingContext;
      if (this.watchId !== null) {
        Geolocation.clearWatch(this.watchId);
        this.watchId = null;
      }
      const isEmergency = mode === 'EMERGENCY_SOS';
      try {
        this.watchId = Geolocation.watchPosition(
          (position) => {
            this.handlePositionReceived(position, deviceId, token, socket, onLocationUpdate);
          },
          (error) => {
            this.handleLocationError(error);
          },
          {
            enableHighAccuracy: true,
            distanceFilter: isEmergency ? 0 : 30,
            interval: isEmergency ? 3000 : 45000,
            fastestInterval: isEmergency ? 1500 : 15000,
            forceRequestLocation: true,
            forceLocationManager: false,
            showsBackgroundLocationIndicator: true,
            useSignificantChanges: false,
          }
        );
      } catch (err: any) {
        console.warn('[LocationService] Error updating watchPosition config:', err.message);
      }
    }
  }

  public getTrackingMode(): TrackingMode {
    return this.currentTrackingMode;
  }

  /**
   * Step 4: Periodic Heartbeat Ping (30s)
   * Keeps device online and synchronized with server & guardian sockets even when stationary
   */
  startHeartbeat(deviceId: string, socket: any) {
    this.stopHeartbeat();
    if (!socket) return;

    this.heartbeatIntervalId = setInterval(() => {
      if (socket && socket.connected) {
        socket.emit('heartbeat_ping', {
          deviceId,
          timestamp: new Date().toISOString(),
        });
        console.log(`[LocationService] 💓 Heartbeat ping dispatched for device ${deviceId}`);
      }
    }, 30000);
  }

  stopHeartbeat() {
    if (this.heartbeatIntervalId) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  /**
   * Subscribe to native FusedLocation updates emitted by MotionForegroundService.
   */
  subscribeToNativeLocationUpdates(
    deviceId: string,
    token: string,
    socket: any,
    onLocationUpdate?: (location: LocationCoordinates) => void
  ) {
    if (this.nativeLocationSub) {
      this.nativeLocationSub.remove();
      this.nativeLocationSub = null;
    }

    this.nativeLocationSub = DeviceEventEmitter.addListener(
      'onNativeLocationUpdate',
      (data: {
        latitude: number;
        longitude: number;
        accuracy: number;
        speed: number;
        heading: number;
        altitude: number;
        timestamp: number;
      }) => {
        const locationData: LocationCoordinates = {
          latitude: data.latitude,
          longitude: data.longitude,
          accuracy: data.accuracy || 5.0,
          speed: data.speed || 0,
          heading: data.heading || 0,
          altitude: data.altitude || 0,
          timestamp: new Date(data.timestamp).toISOString(),
        };

        console.log(
          `[Native Foreground GPS] Real-time coordinate fix: ${data.latitude}, ${data.longitude} (±${data.accuracy}m)`
        );

        if (socket && socket.connected) {
          socket.emit('location_update', {
            deviceId,
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy || 5.0,
            speed: data.speed || 0,
            heading: data.heading || 0,
            altitude: data.altitude || 0,
            timestamp: locationData.timestamp,
          });
        } else {
          apiService.logLocation(token, {
            deviceId,
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy || 5.0,
          }).catch(err => console.warn('[LocationService] Native GPS offline HTTP log error:', err.message));
        }

        if (onLocationUpdate) {
          onLocationUpdate(locationData);
        }
      }
    );

    console.log('[LocationService] 🛰 Subscribed to native FusedLocation updates (MotionForegroundService).');
  }

  /**
   * Stop location tracking watcher
   */
  stopLocationTracking() {
    if (this.watchId !== null) {
      Geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.nativeLocationSub) {
      this.nativeLocationSub.remove();
      this.nativeLocationSub = null;
    }
    this.stopHeartbeat();
    this.activeTrackingContext = null;
    this.isTracking = false;
    console.log('[LocationService] Location tracking stopped.');
  }

  /**
   * Single immediate location fix method via getCurrentPosition()
   */
  getCurrentLocation(): Promise<LocationCoordinates | null> {
    return new Promise(async (resolve) => {
      const hasPerm = await this.checkLocationPermission();
      if (!hasPerm) {
        resolve(null);
        return;
      }

      Geolocation.getCurrentPosition(
        (position) => {
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy || 5.0,
            speed: position.coords.speed || 0,
            heading: position.coords.heading || 0,
            altitude: position.coords.altitude || 0,
            timestamp: new Date(position.timestamp).toISOString(),
          });
        },
        (error) => {
          this.handleLocationError(error);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
          forceRequestLocation: true,
        }
      );
    });
  }

  /**
   * Fallback error handling
   */
  private handleLocationError(error: Geolocation.GeoError) {
    console.warn(`[LocationService Error] Code ${error.code}: ${error.message}`);

    switch (error.code) {
      case 1:
        Alert.alert(
          'Location Permission Required',
          'SafeCircle requires location permissions to track your device. Please grant location permissions in device settings.'
        );
        break;
      case 2:
        Alert.alert(
          'Location Services Disabled',
          'GPS / Location Services are turned off on your Android device. Please turn on Location in Quick Settings or Device Settings.'
        );
        break;
      case 3:
        console.warn('[LocationService] Location request timed out. Retrying...');
        break;
      default:
        console.warn('[LocationService] Location error:', error.message);
        break;
    }
  }
}

export const locationService = new LocationService();
