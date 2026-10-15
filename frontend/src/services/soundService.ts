import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, Platform } from 'react-native';

const { AlarmSoundModule, MotionGuardModule } = NativeModules;

export interface SoundPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  frequencies: number[];
  sweepRateMs: number;
}

const STORAGE_KEY = '@safecircle_alarm_sound_preference';

export const SOUND_PRESETS: SoundPreset[] = [
  {
    id: 'police_siren',
    name: 'Police Emergency Siren',
    description: 'Alternating 800Hz - 1200Hz dual-tone sweep',
    icon: '🚔',
    frequencies: [800, 1200],
    sweepRateMs: 250,
  },
  {
    id: 'tactical_alarm',
    name: 'High-Pitch Tactical Alarm',
    description: 'Piercing 1500Hz high-speed pulse',
    icon: '🚨',
    frequencies: [1500, 1800],
    sweepRateMs: 120,
  },
  {
    id: 'warning_horn',
    name: 'Loud Warning Horn',
    description: 'Dual acoustic 440Hz + 554Hz warning horn',
    icon: '📣',
    frequencies: [440, 554],
    sweepRateMs: 400,
  },
  {
    id: 'security_buzzer',
    name: 'Classic Security Buzzer',
    description: 'High-power 1000Hz rapid pulse buzzer',
    icon: '🔔',
    frequencies: [1000, 600],
    sweepRateMs: 150,
  },
  {
    id: 'air_raid',
    name: 'Nuclear Air-Raid Wail',
    description: 'Gradual wail sweeping from 400Hz to 1600Hz',
    icon: '⚠️',
    frequencies: [400, 1600],
    sweepRateMs: 450,
  },
];

class SoundService {
  private activeInterval: any = null;
  private isPlaying: boolean = false;
  private currentPlayingId: string | null = null;

  /**
   * Get all available alarm sound presets
   */
  public getAvailableSounds(): SoundPreset[] {
    return SOUND_PRESETS;
  }

  /**
   * Get currently selected sound preference ID
   */
  public async getSelectedSound(): Promise<string> {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved && SOUND_PRESETS.some(s => s.id === saved)) {
        return saved;
      }
    } catch (e) {
      console.warn('[SoundService] Failed to read sound preference:', e);
    }
    return 'police_siren'; // Default
  }

  /**
   * Set and persist selected sound preference ID
   */
  public async setSelectedSound(soundId: string): Promise<boolean> {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, soundId);
      console.log(`[SoundService] Sound preference updated to: ${soundId}`);
      return true;
    } catch (e) {
      console.error('[SoundService] Failed to save sound preference:', e);
      return false;
    }
  }

  /**
   * Play / Preview physical alarm siren sound via Native Android AlarmSoundModule
   */
  public playSound(soundId: string = 'police_siren', onTick?: (frequency: number) => void) {
    this.stopSound();

    const preset = SOUND_PRESETS.find(s => s.id === soundId) || SOUND_PRESETS[0];
    this.isPlaying = true;
    this.currentPlayingId = preset.id;

    console.log(`[SoundService] 🔊 Playing native physical alarm sound preset: ${preset.name} (${preset.id})`);

    // 1. Trigger Native Android STREAM_ALARM 100% Volume Hardware Speaker Siren
    if (Platform.OS === 'android' && AlarmSoundModule && AlarmSoundModule.playSound) {
      try {
        AlarmSoundModule.playSound(preset.id);
      } catch (e) {
        console.warn('[SoundService] Native AlarmSoundModule playSound error:', e);
      }
    }

    // 2. Local JS tick callback for UI animations
    let step = 0;
    const freqLow = preset.frequencies[0];
    const freqHigh = preset.frequencies[1];

    this.activeInterval = setInterval(() => {
      if (!this.isPlaying) return;

      const currentFreq = step % 2 === 0 ? freqLow : freqHigh;
      if (onTick) {
        onTick(currentFreq);
      }
      step++;
    }, preset.sweepRateMs);
  }

  /**
   * Stop physical audio playback immediately.
   * NOTE: This only stops the AlarmSoundModule ToneGenerator.
   * To also silence the MotionForegroundService's native alarm, call
   * stopNativeAlarm() alongside this method.
   */
  public stopSound() {
    if (this.activeInterval) {
      clearInterval(this.activeInterval);
      this.activeInterval = null;
    }

    // Stop Native Android STREAM_ALARM Siren (AlarmSoundModule ToneGenerator)
    if (Platform.OS === 'android' && AlarmSoundModule && AlarmSoundModule.stopSound) {
      try {
        AlarmSoundModule.stopSound();
      } catch (e) {
        console.warn('[SoundService] Native AlarmSoundModule stopSound error:', e);
      }
    }

    this.isPlaying = false;
    this.currentPlayingId = null;
    console.log('[SoundService] ⏹️ Physical alarm sound stopped.');
  }

  /**
   * Silence the MotionForegroundService's internal nativeToneGenerator.
   *
   * The service keeps its own ToneGenerator that fires unconditionally when a
   * theft anomaly is detected — even when the JS thread is dead. stopSound()
   * cannot reach it because AlarmSoundModule owns a separate generator.
   * This method bridges to MotionGuardModule.stopNativeAlarm() which uses:
   *   1. A direct in-process call to the live service instance (zero-latency).
   *   2. An Intent ACTION_STOP_NATIVE_ALARM as a belt-and-suspenders fallback.
   *
   * Always call this together with stopSound() when cancelling the SOS alarm.
   */
  public stopNativeAlarm(): void {
    if (Platform.OS === 'android' && MotionGuardModule && MotionGuardModule.stopNativeAlarm) {
      try {
        MotionGuardModule.stopNativeAlarm()
          .then(() => {
            console.log('[SoundService] 🔕 MotionForegroundService native alarm silenced.');
          })
          .catch((e: any) => {
            console.warn('[SoundService] stopNativeAlarm bridge error:', e);
          });
      } catch (e) {
        console.warn('[SoundService] stopNativeAlarm call error:', e);
      }
    }
  }

  /**
   * Trigger the MotionForegroundService's internal nativeToneGenerator directly.
   * Useful when remotely activating the emergency siren from guardian commands.
   */
  public triggerNativeAlarm(): void {
    if (Platform.OS === 'android' && MotionGuardModule && MotionGuardModule.triggerNativeAlarm) {
      try {
        MotionGuardModule.triggerNativeAlarm()
          .then(() => {
            console.log('[SoundService] 🚨 MotionForegroundService native alarm triggered.');
          })
          .catch((e: any) => {
            console.warn('[SoundService] triggerNativeAlarm bridge error:', e);
          });
      } catch (e) {
        console.warn('[SoundService] triggerNativeAlarm call error:', e);
      }
    }
  }

  /**
   * Convenience helper — starts both the AlarmSoundModule ToneGenerator and
   * the MotionForegroundService's nativeToneGenerator in a single call.
   */
  public playAllAlarms(soundId: string = 'police_siren'): void {
    this.playSound(soundId);
    this.triggerNativeAlarm();
  }

  /**
   * Convenience helper — stops both the AlarmSoundModule ToneGenerator and
   * the MotionForegroundService's nativeToneGenerator in a single call.
   * Prefer this over calling stopSound() + stopNativeAlarm() separately.
   */
  public stopAllAlarms(): void {
    this.stopSound();
    this.stopNativeAlarm();
  }

  /**
   * Check if a specific sound ID is currently playing
   */
  public isSoundPlaying(soundId?: string): boolean {
    if (!soundId) return this.isPlaying;
    return this.isPlaying && this.currentPlayingId === soundId;
  }
}

export const soundService = new SoundService();
