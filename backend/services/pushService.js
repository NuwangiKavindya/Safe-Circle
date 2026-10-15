const path = require('path');
const fs = require('fs');

const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

let isInitialized = false;
try {
  const serviceAccountPath = path.join(__dirname, '../config/safe-circle-firebase-key.json');

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    initializeApp({
      credential: cert(serviceAccount),
    });
    isInitialized = true;
    console.log('[PushService] ✅ Firebase Admin SDK initialized successfully.');
  } else {
    console.log('[PushService] ℹ️ Firebase service key not found at config/safe-circle-firebase-key.json. Running in fallback mode.');
  }
} catch (error) {
  console.warn('[PushService] Could not initialize firebase-admin:', error.message);
  isInitialized = false;
}

/**
 * Send High-Priority Emergency Push Notification via FCM
 * @param {Array<string>} targetTokens Array of destination device FCM Tokens
 * @param {Object} alertPayload Alert metadata (ownerName, alertId, latitude, longitude, alertType)
 */
async function sendEmergencyPushNotification(targetTokens, alertPayload) {
  if (!targetTokens || !Array.isArray(targetTokens) || targetTokens.length === 0) {
    console.log('[PushService] No FCM target tokens provided. Skipping push notification.');
    return { success: false, reason: 'NO_TOKENS' };
  }

  const validTokens = targetTokens.filter(t => typeof t === 'string' && t.trim().length > 0);
  if (validTokens.length === 0) return { success: false, reason: 'INVALID_TOKENS' };

  const message = {
    notification: {
      title: `🚨 EMERGENCY ALERT: ${alertPayload.ownerName || 'SafeCircle User'}`,
      body: alertPayload.message || 'Emergency SOS or Theft Anomaly detected. Tap to open live tracker dashboard.',
    },
    data: {
      alertId: String(alertPayload.alertId || ''),
      deviceId: String(alertPayload.deviceId || ''),
      latitude: String(alertPayload.latitude || ''),
      longitude: String(alertPayload.longitude || ''),
      alertType: String(alertPayload.alertType || 'SOS'),
      screen: 'TRACKER_DASHBOARD',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'safecircle_emergency_channel',
        sound: 'default',
        priority: 'max',
        visibility: 'public',
      },
    },
    tokens: validTokens,
  };

  if (isInitialized && getApps().length > 0) {
    try {
      const response = await getMessaging().sendEachForMulticast(message);
      console.log(`[PushService] 🚀 FCM Multicast sent successfully to ${response.successCount} / ${validTokens.length} devices.`);
      return { success: true, response };
    } catch (err) {
      console.error('[PushService Error] Failed to send FCM push:', err);
      return { success: false, error: err };
    }
  } else {
    console.log(`[PushService Mock] 📱 High-Priority System Tray Push simulated for ${validTokens.length} devices: "${message.notification.title}"`);
    return { success: true, simulated: true };
  }
}

/**
 * Send In-App Guardian Designation Push Notification via FCM
 * @param {Array<string>} targetTokens Array of destination device FCM Tokens
 * @param {Object} invitePayload Invitation metadata (ownerName, ownerPhone, wardId, relationship)
 */
async function sendGuardianInvitePushNotification(targetTokens, invitePayload) {
  if (!targetTokens || !Array.isArray(targetTokens) || targetTokens.length === 0) {
    console.log('[PushService] No FCM target tokens for guardian. Skipping push notification.');
    return { success: false, reason: 'NO_TOKENS' };
  }

  const validTokens = targetTokens.filter(t => typeof t === 'string' && t.trim().length > 0);
  if (validTokens.length === 0) return { success: false, reason: 'INVALID_TOKENS' };

  const message = {
    notification: {
      title: `🛡️ New Guardian Designation`,
      body: `${invitePayload.ownerName || 'A contact'} (${invitePayload.relationship || 'Contact'}) added you as their emergency guardian on SafeCircle.`,
    },
    data: {
      wardId: String(invitePayload.wardId || ''),
      ownerName: String(invitePayload.ownerName || ''),
      ownerPhone: String(invitePayload.ownerPhone || ''),
      screen: 'PEOPLE_I_PROTECT',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'safecircle_emergency_channel',
        sound: 'default',
        priority: 'high',
        visibility: 'public',
      },
    },
    tokens: validTokens,
  };

  if (isInitialized && getApps().length > 0) {
    try {
      const response = await getMessaging().sendEachForMulticast(message);
      console.log(`[PushService] 🚀 Guardian invite push sent to ${response.successCount} / ${validTokens.length} devices.`);
      return { success: true, response };
    } catch (err) {
      console.error('[PushService Error] Failed to send guardian invite push:', err);
      return { success: false, error: err };
    }
  } else {
    console.log(`[PushService Mock] 📱 Guardian Invite Push simulated for ${validTokens.length} devices: "${message.notification.title}"`);
    return { success: true, simulated: true };
  }
}

/**
 * Send High-Priority Remote Siren Command via FCM Data Message
 * Bypasses Android Doze mode and background process freezes to trigger/silence physical alarm.
 * @param {Array<string>} targetTokens Array of destination device FCM Tokens
 * @param {Object} sirenPayload Siren metadata (action: 'START' | 'STOP', deviceId, targetUserId, triggeredBy)
 */
async function sendRemoteSirenPushNotification(targetTokens, sirenPayload) {
  if (!targetTokens || !Array.isArray(targetTokens) || targetTokens.length === 0) {
    console.log('[PushService] No FCM target tokens provided for remote siren. Skipping push.');
    return { success: false, reason: 'NO_TOKENS' };
  }

  const validTokens = targetTokens.filter(t => typeof t === 'string' && t.trim().length > 0);
  if (validTokens.length === 0) return { success: false, reason: 'INVALID_TOKENS' };

  const isStart = sirenPayload.action === 'START';

  const message = {
    data: {
      type: 'REMOTE_SIREN',
      alarm_action: isStart ? 'START' : 'STOP',
      action: isStart ? 'START' : 'STOP',
      deviceId: String(sirenPayload.deviceId || ''),
      targetUserId: String(sirenPayload.targetUserId || sirenPayload.userId || ''),
      triggeredBy: String(sirenPayload.triggeredBy || 'GUARDIAN'),
      timestamp: new Date().toISOString()
    },
    android: {
      priority: 'high',
      ...(isStart ? {
        notification: {
          channelId: 'safecircle_emergency_channel',
          title: '🚨 REMOTE EMERGENCY SIREN ACTIVATED',
          body: 'A trusted guardian has remotely triggered the audible siren on this device.',
          sound: 'default',
          priority: 'max',
          visibility: 'public'
        }
      } : {})
    },
    tokens: validTokens,
  };

  if (isInitialized && getApps().length > 0) {
    try {
      const response = await getMessaging().sendEachForMulticast(message);
      console.log(`[PushService] 🚀 Remote Siren (${isStart ? 'START' : 'STOP'}) push sent to ${response.successCount} / ${validTokens.length} devices.`);
      return { success: true, response };
    } catch (err) {
      console.error('[PushService Error] Failed to send remote siren push:', err);
      return { success: false, error: err };
    }
  } else {
    console.log(`[PushService Mock] 📱 Remote Siren Push simulated for ${validTokens.length} devices: action=${isStart ? 'START' : 'STOP'}`);
    return { success: true, simulated: true };
  }
}

module.exports = {
  sendEmergencyPushNotification,
  sendGuardianInvitePushNotification,
  sendRemoteSirenPushNotification,
};


