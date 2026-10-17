/* global jest */
// Jest setup for React Native unit and integration tests

// Mock React Native NativeModules
import { NativeModules } from 'react-native';

NativeModules.RNFSManager = {
  RNFSFileTypeRegular: 'regular',
  RNFSFileTypeDirectory: 'directory',
};

NativeModules.MotionGuardModule = {
  runTFLiteInference: jest.fn(() => Promise.resolve({ isAnomaly: false, confidenceScore: 0.1, latencyMs: 2.0 })),
  startBackgroundMonitoring: jest.fn(() => Promise.resolve(true)),
  stopBackgroundMonitoring: jest.fn(() => Promise.resolve(true)),
  setTrackingMode: jest.fn(() => Promise.resolve(true)),
  isServiceRunning: jest.fn(() => Promise.resolve(false)),
  triggerNativeAlarm: jest.fn(() => Promise.resolve(true)),
  stopNativeAlarm: jest.fn(() => Promise.resolve(true)),
};

NativeModules.AudioRecorderModule = {
  recordAmbientAudio: jest.fn(() => Promise.resolve({ uri: 'file:///mock/audio.m4a', name: 'audio.m4a', type: 'audio/m4a', size: 1024, duration: 5 })),
  createFallbackAudio: jest.fn(() => Promise.resolve({ uri: 'file:///mock/fallback.mp3', name: 'fallback.mp3', type: 'audio/mp3', size: 512, duration: 2 })),
  stopRecording: jest.fn(() => Promise.resolve(true)),
  isRecording: jest.fn(() => Promise.resolve(false)),
};

NativeModules.AlarmSoundModule = {
  playSound: jest.fn(),
  stopSound: jest.fn(),
};

NativeModules.TorchModule = {
  isAvailable: jest.fn(() => Promise.resolve(true)),
  setTorchMode: jest.fn(() => Promise.resolve(true)),
  toggleTorch: jest.fn(() => Promise.resolve(true)),
  isTorchActive: jest.fn(() => Promise.resolve(false)),
};

// Global react-native-fs mock
jest.mock('react-native-fs', () => ({
  DocumentDirectoryPath: '/mock/document/path',
  CachesDirectoryPath: '/mock/cache/path',
  writeFile: jest.fn(() => Promise.resolve()),
  readFile: jest.fn(() => Promise.resolve('')),
  exists: jest.fn(() => Promise.resolve(true)),
  mkdir: jest.fn(() => Promise.resolve()),
  uploadFiles: jest.fn(() => ({
    promise: Promise.resolve({
      statusCode: 200,
      body: JSON.stringify({ success: true, data: { audioFileUrl: '/uploads/audio/mock.m4a' } }),
    }),
  })),
}));

// Global react-native-fast-tflite and nitro-modules mock
jest.mock('react-native-nitro-modules', () => ({
  NitroModules: {},
}));

jest.mock('react-native-fast-tflite', () => ({
  loadTensorflowModel: jest.fn(() =>
    Promise.resolve({
      run: jest.fn(() => Promise.resolve([0.1])),
      runSync: jest.fn(() => [0.1]),
    })
  ),
}));
