import { locationService } from '../src/services/locationService';
import { motionService } from '../src/services/motionService';

jest.mock('../src/services/motionService', () => ({
  motionService: {
    setTrackingMode: jest.fn(() => Promise.resolve(true)),
  },
}));

jest.mock('react-native-geolocation-service', () => ({
  watchPosition: jest.fn(() => 999),
  clearWatch: jest.fn(),
  getCurrentPosition: jest.fn((success) => {
    success({
      coords: {
        latitude: 6.9271,
        longitude: 79.8612,
        accuracy: 4.0,
        speed: 0,
        heading: 0,
        altitude: 0,
      },
      timestamp: Date.now(),
    });
  }),
}));

describe('Step 4: Background Resilience & Heartbeat Verification', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    locationService.stopLocationTracking();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Adaptive Location Tracking Intervals', () => {
    it('sets initial mode to PASSIVE_MONITORING to conserve battery', () => {
      expect(locationService.getTrackingMode()).toBe('PASSIVE_MONITORING');
    });

    it('dynamically switches to EMERGENCY_SOS mode and propagates to native service', () => {
      locationService.setTrackingMode('EMERGENCY_SOS');
      expect(locationService.getTrackingMode()).toBe('EMERGENCY_SOS');
      expect(motionService.setTrackingMode).toHaveBeenCalledWith('EMERGENCY_SOS');
    });

    it('dynamically switches back to PASSIVE_MONITORING upon emergency resolution', () => {
      locationService.setTrackingMode('EMERGENCY_SOS');
      locationService.setTrackingMode('PASSIVE_MONITORING');
      expect(locationService.getTrackingMode()).toBe('PASSIVE_MONITORING');
      expect(motionService.setTrackingMode).toHaveBeenCalledWith('PASSIVE_MONITORING');
    });
  });

  describe('Device Heartbeat Ping & Liveness Synchronization', () => {
    it('dispatches heartbeat_ping every 30 seconds when socket is connected', () => {
      const mockSocket = {
        connected: true,
        emit: jest.fn(),
      };

      locationService.startHeartbeat('dev-test-123', mockSocket);

      // Fast-forward 30 seconds
      jest.advanceTimersByTime(30000);
      expect(mockSocket.emit).toHaveBeenCalledWith(
        'heartbeat_ping',
        expect.objectContaining({
          deviceId: 'dev-test-123',
          timestamp: expect.any(String),
        })
      );

      // Fast-forward another 30 seconds (total 60s)
      jest.advanceTimersByTime(30000);
      expect(mockSocket.emit).toHaveBeenCalledTimes(2);

      locationService.stopHeartbeat();
      jest.advanceTimersByTime(30000);
      // No further pings after stopping
      expect(mockSocket.emit).toHaveBeenCalledTimes(2);
    });
  });
});
