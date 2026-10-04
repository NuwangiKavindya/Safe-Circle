import { NativeModules, Platform } from 'react-native';

const { TorchModule } = NativeModules;

class TorchService {
  private isSupported: boolean = Platform.OS === 'android' && !!TorchModule;

  public async isAvailable(): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      return await TorchModule.isAvailable();
    } catch {
      return false;
    }
  }

  public async setTorch(enabled: boolean): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      return await TorchModule.setTorchMode(enabled);
    } catch (e) {
      console.warn('[TorchService] Error setting torch:', e);
      return false;
    }
  }

  public async toggleTorch(): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      return await TorchModule.toggleTorch();
    } catch (e) {
      console.warn('[TorchService] Error toggling torch:', e);
      return false;
    }
  }

  public async isTorchActive(): Promise<boolean> {
    if (!this.isSupported) return false;
    try {
      return await TorchModule.isTorchActive();
    } catch {
      return false;
    }
  }
}

export const torchService = new TorchService();
