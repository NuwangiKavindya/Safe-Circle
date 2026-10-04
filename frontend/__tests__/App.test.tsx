/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: jest.fn(),
    hasPlayServices: jest.fn(() => Promise.resolve(true)),
    signIn: jest.fn(() => Promise.resolve({ user: { id: 'test' } })),
  },
  statusCodes: {}
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
  clear: jest.fn(() => Promise.resolve()),
}));

jest.mock('react-native-geolocation-service', () => ({
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
}));

jest.mock('@maplibre/maplibre-react-native', () => ({
  MapView: () => 'MapView',
  Camera: () => 'Camera',
  ShapeSource: () => 'ShapeSource',
  SymbolLayer: () => 'SymbolLayer',
  LineLayer: () => 'LineLayer',
  FillLayer: () => 'FillLayer',
  setAccessToken: jest.fn(),
}));

jest.mock('react-native-sensors', () => ({
  magnetometer: {
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
  },
  SensorTypes: { magnetometer: 'magnetometer' },
  setUpdateIntervalForType: jest.fn(),
}));

jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/path',
  writeFile: jest.fn(() => Promise.resolve()),
  readFile: jest.fn(() => Promise.resolve('')),
  exists: jest.fn(() => Promise.resolve(true)),
  mkdir: jest.fn(() => Promise.resolve()),
}));

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
