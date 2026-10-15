import { PermissionsAndroid, Platform } from 'react-native';
import { apiService } from './api';
import { soundService } from './soundService';

let messagingModule: any = null;
try {
  messagingModule = require('@react-native-firebase/messaging').default;
} catch (e) {
  messagingModule = null;
}

class FcmService {
  private isInitialized: boolean = false;
  private unsubscribeOpened: any = null;
  private unsubscribeForeground: any = null;

  /**
   * Request FCM Push Notification Permission & Register Token with Backend
   */
  public async initialize(
    userToken: string,
    onNavigateToTracker?: (alertId?: string) => void
  ) {
    if (!userToken) return;

    try {
      // 1. Android 13+ (API 33+) POST_NOTIFICATIONS Permission Prompt
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          console.log('[FcmService] POST_NOTIFICATIONS permission denied by user.');
        }
      }

      if (messagingModule) {
        // 2. Request Messaging Permission
        const authStatus = await messagingModule().requestPermission();
        const enabled =
          authStatus === messagingModule.AuthorizationStatus.AUTHORIZED ||
          authStatus === messagingModule.AuthorizationStatus.PROVISIONAL;

        if (enabled) {
          // 3. Obtain FCM Device Token
          const fcmToken = await messagingModule().getToken();
          if (fcmToken) {
            console.log('[FcmService] 📱 FCM Device Token obtained:', fcmToken);
            await apiService.saveFcmToken(userToken, fcmToken);
          }
        }

        // 4. Setup Notification Open Handlers
        this.setupNotificationHandlers(onNavigateToTracker);
        this.isInitialized = true;
      } else {
        console.log('[FcmService] ℹ️ @react-native-firebase/messaging not present. Running FCM in dev mode.');
      }
    } catch (error: any) {
      console.warn('[FcmService] Error initializing FCM notifications:', error.message || error);
    }
  }

  /**
   * Setup Handlers for Foreground, Background, and Quit-State System Tray Notification Taps
   */
  private setupNotificationHandlers(onNavigateToTracker?: (alertId?: string) => void) {
    if (!messagingModule) return;

    // A. Initial Notification Check (App opened from Quit State)
    messagingModule()
      .getInitialNotification()
      .then((remoteMessage: any) => {
        if (remoteMessage) {
          console.log('[FcmService] App launched from Quit State via System Tray Notification:', remoteMessage);
          if (onNavigateToTracker && remoteMessage.data?.screen === 'TRACKER_DASHBOARD') {
            onNavigateToTracker(remoteMessage.data?.alertId);
          }
        }
      });

    // B. Notification Opened from Background State
    this.unsubscribeOpened = messagingModule().onNotificationOpenedApp((remoteMessage: any) => {
      console.log('[FcmService] Notification tapped from Background State:', remoteMessage);
      if (onNavigateToTracker && remoteMessage.data?.screen === 'TRACKER_DASHBOARD') {
        onNavigateToTracker(remoteMessage.data?.alertId);
      }
    });

    // C. Foreground Notification Receiver
    this.unsubscribeForeground = messagingModule().onMessage(async (remoteMessage: any) => {
      console.log('[FcmService] 🚨 Foreground FCM Message received:', remoteMessage.notification?.title || remoteMessage.data);
      const data = remoteMessage.data;
      if (data && (data.type === 'REMOTE_SIREN' || data.alarm_action)) {
        const action = data.alarm_action || data.action;
        if (action === 'START') {
          soundService.getSelectedSound().then(preferred => {
            soundService.playAllAlarms(preferred || 'police_siren');
          });
        } else if (action === 'STOP') {
          soundService.stopAllAlarms();
        }
      }
    });
  }

  public cleanup() {
    if (this.unsubscribeOpened) this.unsubscribeOpened();
    if (this.unsubscribeForeground) this.unsubscribeForeground();
    this.unsubscribeOpened = null;
    this.unsubscribeForeground = null;
  }
}

export const fcmService = new FcmService();
