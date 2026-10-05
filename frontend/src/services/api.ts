import { Platform } from 'react-native';
import RNFS from 'react-native-fs';
import { API_BASE_URL as ENV_API_BASE_URL } from '@env';

// Default Fallbacks
export const LIVE_SERVER_URL = 'http://35.154.31.80';
export const LOCAL_SERVER_URL = `http://${Platform.OS === 'android' ? '10.0.2.2' : 'localhost'}:5001`;

// Active backend URL: Loaded dynamically from frontend/.env (defaults to LIVE_SERVER_URL if undefined)
export const API_BASE_URL = ENV_API_BASE_URL || LIVE_SERVER_URL;

export interface RegisterPayload {
  fullName: string;
  email: string;
  phoneNumber: string;
  password?: string;
  confirmPassword?: string;
}

export interface LoginPayload {
  email: string;
  password?: string;
}

export interface GoogleLoginPayload {
  idToken: string;
}

export interface BindDevicePayload {
  deviceName: string;
  deviceModel: string;
  imeiNumber: string;
  deviceOs: string;
}

export interface AddContactPayload {
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  relationship?: string;
}

export interface TrustedContact {
  id: string;
  userId: string;
  contactName: string;
  contactPhone: string;
  contactEmail?: string;
  relationship?: string;
  isVerified: boolean;
  accessCode: string;
  sharingMode?: 'EMERGENCY_ONLY' | 'ALWAYS_ON';
  createdAt: string;
}

export interface SafeZone {
  id: string;
  userId: string;
  zoneName: string;
  latitude: number | string;
  longitude: number | string;
  radiusMeters: number | string;
  isActive: boolean;
  createdAt?: string;
}

export interface CreateSafeZonePayload {
  zoneName: string;
  latitude: number;
  longitude: number;
  radiusMeters?: number;
}

export interface ContactDeliveryStatus {
  isRegisteredUser: boolean;
  deliveryChannel: 'PUSH_NOTIFICATION' | 'EMAIL_INVITATION' | 'MANUAL_SHARE' | 'NONE';
  message?: string;
  targetUserId?: string;
}

export interface ContactResponse {
  success: boolean;
  message?: string;
  data?: TrustedContact;
  delivery?: ContactDeliveryStatus;
  totpProvisioningUri?: string;
}

export interface GuardianshipWard {
  contactId: string;
  accessCode: string;
  relationship?: string;
  sharingMode: 'EMERGENCY_ONLY' | 'ALWAYS_ON';
  isVerified: boolean;
  isActiveSos: boolean;
  wardUser: {
    id: string;
    fullName: string;
    phoneNumber: string;
    email: string;
  };
  alertDetails?: {
    id: string;
    alertType: string;
    latitude: number;
    longitude: number;
    createdAt: string;
  } | null;
}

export interface GuardianshipListResponse {
  success: boolean;
  message?: string;
  count?: number;
  data?: GuardianshipWard[];
}

export interface ContactListResponse {
  success: boolean;
  message?: string;
  count?: number;
  data?: TrustedContact[];
}

export interface AuthResponse {
  success: boolean;
  token?: string;
  message?: string;
  requiresPhoneNumber?: boolean;
  data?: {
    id: string;
    fullName: string;
    email: string;
    phoneNumber?: string;
  };
}

export interface DeviceResponse {
  success: boolean;
  message?: string;
  data?: {
    id: string;
    userId: string;
    deviceName: string;
    deviceModel: string;
    imeiNumber: string;
    deviceOs: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface DeviceListResponse {
  success: boolean;
  message?: string;
  count?: number;
  data?: Array<{
    id: string;
    userId: string;
    deviceName: string;
    deviceModel: string;
    imeiNumber: string;
    deviceOs: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface LocationPayload {
  deviceId: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface LocationResponse {
  success: boolean;
  message?: string;
  data?: {
    id: string;
    deviceId: string;
    latitude: string;
    longitude: string;
    accuracy?: string;
    timestamp: string;
    createdAt: string;
    updatedAt: string;
  };
}

export interface AlertPayload {
  deviceId?: string;
  alertType: string;
  latitude?: number;
  longitude?: number;
}

export interface Alert {
  id: string;
  userId: string;
  deviceId?: string;
  alertType: string;
  status: string;
  latitude?: string;
  longitude?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  audioFileUrl?: string;
}

export interface AlertResponse {
  success: boolean;
  message?: string;
  data?: Alert;
}

export interface ActiveAlertsResponse {
  success: boolean;
  message?: string;
  count?: number;
  data?: Alert[];
}

export interface VerifyCodeResponse {
  success: boolean;
  message?: string;
  trackerSessionToken?: string;
  data?: {
    contactName: string;
    relationship: string;
    sharingMode?: 'EMERGENCY_ONLY' | 'ALWAYS_ON';
    targetUser: {
      id: string;
      fullName: string;
      phoneNumber?: string;
    };
    isActiveSos: boolean;
    alertId: string | null;
    deviceId?: string | null;
    audioFileUrl: string | null;
    isRemoteSirenActive?: boolean;
  };
}

export interface SharedLocationHistoryResponse {
  success: boolean;
  message?: string;
  count?: number;
  data?: Array<{
    id: string;
    deviceId: string;
    latitude: string;
    longitude: string;
    accuracy?: string;
    timestamp: string;
  }>;
}


class ApiService {
  /**
   * Register a new user with email and password
   */
  async register(payload: RegisterPayload): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Registration failed',
        };
      }

      return {
        success: true,
        token: data.token,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Login with email and password
   */
  async login(payload: LoginPayload): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Login failed',
        };
      }

      return {
        success: true,
        token: data.token,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Login/Register via Google SSO
   */
  async googleLogin(payload: GoogleLoginPayload): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Google authentication failed',
        };
      }

      return {
        success: true,
        token: data.token,
        requiresPhoneNumber: data.requiresPhoneNumber,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Update Phone Number for authenticated user
   */
  async updatePhoneNumber(phoneNumber: string, token: string): Promise<AuthResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/update-phone`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ phoneNumber }),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to update phone number',
        };
      }

      return {
        success: true,
        message: data.message,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred while updating phone number',
      };
    }
  }

  /**
   * Fetch all bound devices for the current user
   */
  async getDevices(token: string): Promise<DeviceListResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/device`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to fetch devices',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Bind a new device to the current user
   */
  async bindDevice(token: string, payload: BindDevicePayload): Promise<DeviceResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/device/bind`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Device binding failed',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Unbind a device
   */
  async unbindDevice(token: string, deviceId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/device/${deviceId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Device unbinding failed',
        };
      }

      return {
        success: true,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Fetch all trusted contacts
   */
  async getContacts(token: string): Promise<ContactListResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to fetch contacts',
        };
      }

      return {
        success: true,
        count: data.count,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Fetch all users who have added the logged-in user as their trusted contact (Guardianship Circle)
   */
  async getGuardianshipList(token: string): Promise<GuardianshipListResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts/guardianship`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to fetch guardianship list',
        };
      }

      return {
        success: true,
        count: data.count,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Start an authenticated tracker session for a ward in the user's Guardianship Circle (1-tap tracking)
   */
  async startGuardianTrackerSession(token: string, accessCode: string): Promise<VerifyCodeResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts/guardianship/${accessCode}/session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to start tracking session',
        };
      }

      return {
        success: true,
        trackerSessionToken: data.trackerSessionToken,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Remotely trigger or silence the physical audible alarm siren on ward's device
   */
  async triggerRemoteSiren(
    token: string,
    deviceId: string | undefined,
    action: 'START' | 'STOP',
    targetUserId?: string
  ): Promise<{ success: boolean; action?: string; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts/shared/remote-siren`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ deviceId, action, targetUserId }),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to trigger remote siren',
        };
      }

      return {
        success: true,
        action: data.action,
        message: data.message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Add a new trusted contact
   */
  async addContact(token: string, payload: AddContactPayload): Promise<ContactResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to add trusted contact',
        };
      }

      return {
        success: true,
        data: data.data,
        delivery: data.delivery,
        totpProvisioningUri: data.totpProvisioningUri,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Delete a trusted contact
   */
  async deleteContact(token: string, contactId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to delete trusted contact',
        };
      }

      return {
        success: true,
        message: data.message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Update location sharing mode for a trusted contact
   */
  async updateContactSharingMode(
    token: string,
    contactId: string,
    sharingMode: 'EMERGENCY_ONLY' | 'ALWAYS_ON'
  ): Promise<{ success: boolean; data?: TrustedContact; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts/${contactId}/sharing-mode`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ sharingMode }),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to update contact sharing mode',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Log device geolocation coordinates
   */
  async logLocation(token: string, payload: LocationPayload): Promise<LocationResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/location/log`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to log location',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Trigger an SOS Alert
   */
  async triggerAlert(token: string, payload: AlertPayload): Promise<AlertResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/alerts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to trigger alert',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Resolve an active SOS alert
   */
  async resolveAlert(token: string, alertId: string): Promise<AlertResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/alerts/${alertId}/resolve`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to resolve alert',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Get user's active SOS alerts
   */
  async getActiveAlerts(token: string): Promise<ActiveAlertsResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/alerts/active`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to fetch active alerts',
        };
      }

      return {
        success: true,
        count: data.count,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Verify contact using RFC 6238 TOTP two-field protocol.
   *
   * @param accessCode  - Stable contact handle (e.g. "SC-A3F2B1C9"), shared once in invitation.
   * @param totpToken   - Rotating 6-digit TOTP from Google Authenticator / Authy. Valid 30s.
   */
  async verifyAccessCode(accessCode: string, totpToken: string): Promise<VerifyCodeResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts/shared/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ accessCode, totpToken }),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Verification failed',
        };
      }

      return {
        success: true,
        trackerSessionToken: data.trackerSessionToken,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Get current session status and active SOS state using Tracker Session JWT (for polling)
   */
  async getTrackerSessionStatus(trackerSessionToken: string): Promise<VerifyCodeResponse> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/contacts/shared/status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${trackerSessionToken}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to poll tracker status',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Get shared distress tracking location history logs using access code and tracker session JWT
   */
  async getSharedLocationHistory(accessCode: string, trackerSessionToken?: string): Promise<SharedLocationHistoryResponse> {
    try {
      const headers: Record<string, string> = {};
      if (trackerSessionToken) {
        headers['Authorization'] = `Bearer ${trackerSessionToken}`;
      }

      const response = await fetch(`${API_BASE_URL}/api/contacts/shared/location/${accessCode}`, {
        method: 'GET',
        headers,
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to load tracking coordinates history',
        };
      }

      return {
        success: true,
        count: data.count,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Upload SOS ambient audio recording
   */
  async uploadAmbientAudio(token: string, alertId: string, audioFile: any): Promise<AlertResponse> {
    try {
      const fileName = audioFile.name || `ambient-sos-snapshot-${Date.now().toString().slice(-4)}.m4a`;
      const mimeType = audioFile.type || 'audio/m4a';

      // 1. Try RNFS native file uploader first on Android (direct disk-to-HTTP streaming, bypasses JS FormData bridge)
      if (audioFile.uri && !audioFile.uri.startsWith('data:') && RNFS && typeof RNFS.uploadFiles === 'function') {
        try {
          const diskFilePath = audioFile.uri.replace(/^file:\/\//, '');
          console.log(`[Audio Upload] Initiating RNFS native multipart upload: ${diskFilePath}`);

          let uploadResult = await RNFS.uploadFiles({
            toUrl: `${API_BASE_URL}/api/contacts/shared/alerts/${alertId}/audio`,
            files: [{
              name: 'audio',
              filename: fileName,
              filepath: diskFilePath,
              filetype: mimeType,
            }],
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
            },
            fields: {},
          }).promise;

          if (uploadResult.statusCode === 404) {
            console.log(`[Audio Upload] Shared endpoint returned 404, retrying at ${API_BASE_URL}/api/alerts/${alertId}/audio`);
            uploadResult = await RNFS.uploadFiles({
              toUrl: `${API_BASE_URL}/api/alerts/${alertId}/audio`,
              files: [{
                name: 'audio',
                filename: fileName,
                filepath: diskFilePath,
                filetype: mimeType,
              }],
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
              },
              fields: {},
            }).promise;
          }

          if (uploadResult.statusCode >= 200 && uploadResult.statusCode < 300) {
            const data = JSON.parse(uploadResult.body);
            console.log('[Audio Upload] ✅ RNFS native upload succeeded:', data);
            return {
              success: true,
              data: data.data,
            };
          } else {
            console.warn(`[Audio Upload] RNFS returned status ${uploadResult.statusCode}:`, uploadResult.body);
            try {
              const errData = JSON.parse(uploadResult.body);
              return {
                success: false,
                message: errData.message || `Upload failed with status ${uploadResult.statusCode}`,
              };
            } catch (_) {
              // fallback below
            }
          }
        } catch (rnfsError: any) {
          console.warn('[Audio Upload] RNFS native upload failed, falling back to fetch FormData:', rnfsError.message || rnfsError);
        }
      }

      // 2. Fallback to standard fetch FormData
      const formData = new FormData();
      const filePart = {
        uri: audioFile.uri,
        type: mimeType,
        name: fileName,
      };
      formData.append('audio', filePart as any);

      console.log(`[Audio Upload] Posting audio via fetch to ${API_BASE_URL}/api/contacts/shared/alerts/${alertId}/audio (URI: ${filePart.uri})`);

      let response = await fetch(`${API_BASE_URL}/api/contacts/shared/alerts/${alertId}/audio`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (response.status === 404) {
        console.log(`[Audio Upload] Shared endpoint 404, falling back to ${API_BASE_URL}/api/alerts/${alertId}/audio`);
        response = await fetch(`${API_BASE_URL}/api/alerts/${alertId}/audio`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
          body: formData,
        });
      }

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Ambient audio upload failed',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      console.warn('[Audio Upload Exception]:', error.message || error);
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Fetch user's active safe zones (geofences)
   */
  async getSafeZones(token: string): Promise<{ success: boolean; data?: SafeZone[]; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/geofence`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to fetch safe zones',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Create a new safe zone (geofence)
   */
  async createSafeZone(token: string, payload: CreateSafeZonePayload): Promise<{ success: boolean; data?: SafeZone; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/geofence`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to create safe zone',
        };
      }

      return {
        success: true,
        data: data.data,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Delete a safe zone (geofence)
   */
  async deleteSafeZone(token: string, safeZoneId: string): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/geofence/${safeZoneId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to delete safe zone',
        };
      }

      return {
        success: true,
        message: data.message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred',
      };
    }
  }

  /**
   * Save / Register FCM Device Token for Push Notifications
   */
  async saveFcmToken(token: string, fcmToken: string): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/device/fcm-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ fcmToken }),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to save FCM token',
        };
      }

      return {
        success: true,
        message: data.message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred while saving FCM token',
      };
    }
  }

  /**
   * Update User Preferred Emergency Alarm Sound Preference
   */
  async updateAlarmSoundPreference(token: string, alarmSound: string): Promise<{ success: boolean; message?: string }> {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/alarm-sound`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ alarmSound }),
      });

      const data = await response.json();
      if (!response.ok) {
        return {
          success: false,
          message: data.message || 'Failed to update alarm sound preference',
        };
      }

      return {
        success: true,
        message: data.message,
      };
    } catch (error: any) {
      return {
        success: false,
        message: error.message || 'Network error occurred while updating alarm sound preference',
      };
    }
  }
}

export const apiService = new ApiService();
