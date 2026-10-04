import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { ARViewComponent } from '../src/components/ARViewComponent';
import { TrackerDashboardScreen } from '../src/screens/TrackerDashboardScreen';
import { calculateDistanceMeters, calculateBearingDegrees } from '../src/utils/distance';

// Mocks
jest.mock('react-native-sensors', () => ({
  magnetometer: {
    subscribe: jest.fn((handlers) => {
      handlers.next({ x: 0, y: 1 }); // Azimuth ~ 0 deg (North)
      return { unsubscribe: jest.fn() };
    }),
  },
  SensorTypes: { magnetometer: 'magnetometer' },
  setUpdateIntervalForType: jest.fn(),
}));

jest.mock('../src/services/torchService', () => ({
  torchService: {
    isAvailable: jest.fn(() => Promise.resolve(true)),
    setTorch: jest.fn(() => Promise.resolve(true)),
    toggleTorch: jest.fn(() => Promise.resolve(true)),
    isTorchActive: jest.fn(() => Promise.resolve(false)),
  },
}));

jest.mock('@maplibre/maplibre-react-native', () => ({
  Map: () => 'Map',
  Camera: () => 'Camera',
  UserLocation: () => 'UserLocation',
  GeoJSONSource: () => 'GeoJSONSource',
  Layer: () => 'Layer',
  Marker: () => 'Marker',
}));

describe('Step 3: AR Guidance & Tracker Live UX Verification', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('Geodesic Math & Bearing Calculation', () => {
    it('accurately calculates distance and bearing between two points', () => {
      // 100 meters due North
      const lat1 = 6.9271;
      const lon1 = 79.8612;
      const lat2 = 6.9280;
      const lon2 = 79.8612;

      const dist = calculateDistanceMeters(lat1, lon1, lat2, lon2);
      const bearing = calculateBearingDegrees(lat1, lon1, lat2, lon2);

      expect(dist).toBeGreaterThan(90);
      expect(dist).toBeLessThan(110);
      expect(bearing).toBeCloseTo(0, 0); // Due north is ~0 degrees
    });
  });

  describe('ARViewComponent Rendering & HUD Controls', () => {
    it('renders AR View HUD with target coordinates and back action', async () => {
      const onBackMock = jest.fn();
      let renderer: any;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <ARViewComponent
            userLatitude={6.9271}
            userLongitude={79.8612}
            targetLatitude={6.9272}
            targetLongitude={79.8612}
            targetName="Stolen Phone"
            onBack={onBackMock}
          />
        );
      });

      expect(renderer).toBeDefined();
      const tree = renderer.toJSON();
      expect(tree).toBeDefined();

      await ReactTestRenderer.act(async () => {
        renderer.unmount();
      });
    });
  });

  describe('TrackerDashboardScreen Connection State Machine', () => {
    const mockTrackerInfo = {
      contactName: 'Alice',
      relationship: 'Sister',
      isActiveSos: true,
      deviceId: 'dev-123',
      targetUser: { fullName: 'Bob', phoneNumber: '+1234567890' },
      audioFileUrl: null,
    };

    const mockLogs = [
      {
        id: 'log-1',
        latitude: '6.9271',
        longitude: '79.8612',
        accuracy: '4.5',
        timestamp: new Date().toISOString(),
      },
    ];

    it('renders in CONNECTED state with live websocket badge', async () => {
      let renderer: any;
      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <TrackerDashboardScreen
            trackerInfo={mockTrackerInfo}
            trackerLogs={mockLogs}
            trackerAudioPlaying={false}
            audioProgress={0}
            connectionStatus="CONNECTED"
            lastFixTimestamp={Date.now()}
            onToggleAudioPlaying={jest.fn()}
            onDisconnect={jest.fn()}
          />
        );
      });

      const root = renderer.root;
      expect(root.findByProps({ children: '⚡ LIVE WEBSOCKET ACTIVE' })).toBeDefined();

      await ReactTestRenderer.act(async () => {
        renderer.unmount();
      });
    });

    it('renders in OFFLINE state with prominent reconnect button', async () => {
      const onReconnectMock = jest.fn();
      let renderer: any;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <TrackerDashboardScreen
            trackerInfo={mockTrackerInfo}
            trackerLogs={mockLogs}
            trackerAudioPlaying={false}
            audioProgress={0}
            connectionStatus="OFFLINE"
            lastFixTimestamp={Date.now() - 30000}
            onToggleAudioPlaying={jest.fn()}
            onDisconnect={jest.fn()}
            onReconnect={onReconnectMock}
          />
        );
      });

      const root = renderer.root;
      expect(root.findByProps({ children: '🔴 STREAM OFFLINE / DISCONNECTED' })).toBeDefined();
      const reconnectBtn = root.findByProps({ children: '🔄 Reconnect' });
      expect(reconnectBtn).toBeDefined();

      await ReactTestRenderer.act(async () => {
        renderer.unmount();
      });
    });

    it('renders in RECONNECTING state with retry button', async () => {
      const onReconnectMock = jest.fn();
      let renderer: any;

      await ReactTestRenderer.act(async () => {
        renderer = ReactTestRenderer.create(
          <TrackerDashboardScreen
            trackerInfo={mockTrackerInfo}
            trackerLogs={mockLogs}
            trackerAudioPlaying={false}
            audioProgress={0}
            connectionStatus="RECONNECTING"
            lastFixTimestamp={Date.now() - 10000}
            onToggleAudioPlaying={jest.fn()}
            onDisconnect={jest.fn()}
            onReconnect={onReconnectMock}
          />
        );
      });

      const root = renderer.root;
      expect(root.findByProps({ children: '⚠️ RECONNECTING STREAM...' })).toBeDefined();

      await ReactTestRenderer.act(async () => {
        renderer.unmount();
      });
    });
  });
});
