import React, { useState, useEffect, useRef } from 'react';
import { Animated, Platform, Alert, Modal, View, Text, TouchableOpacity, Vibration, Share, NativeModules } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';

import { apiService, API_BASE_URL, SafeZone } from './src/services/api';
import { locationService, LocationCoordinates } from './src/services/locationService';
import { motionService, SensitivityMode } from './src/services/motionService';
import { fcmService } from './src/services/fcmService';
import { soundService } from './src/services/soundService';
import {
  ScreenType,
  UserData,
  BoundDevice,
  TrustedContact,
  ApiAlert,
  SignUpFormState,
  SignInFormState,
  DeviceFormState,
  ContactFormState,
  GuardianshipWard,
} from './src/types';
import { globalStyles } from './src/styles/theme';
import { FeedbackBanner } from './src/components/FeedbackBanner';

import { WelcomeScreen } from './src/screens/WelcomeScreen';
import { SignUpScreen } from './src/screens/SignUpScreen';
import { GooglePhoneRegisterScreen } from './src/screens/GooglePhoneRegisterScreen';
import { DashboardScreen } from './src/screens/DashboardScreen';
import { BindDeviceScreen } from './src/screens/BindDeviceScreen';
import { AddContactScreen } from './src/screens/AddContactScreen';
import { TrackerAuthScreen } from './src/screens/TrackerAuthScreen';
import { TrackerDashboardScreen } from './src/screens/TrackerDashboardScreen';
import { MapViewComponent } from './src/components/MapViewComponent';
import { ARViewComponent } from './src/components/ARViewComponent';
import { TacticalSplitMapScreen } from './src/screens/TacticalSplitMapScreen';
import { OfflinePackModal } from './src/components/OfflinePackModal';
import { ThemeProvider } from './src/context/ThemeContext';
// DEV ONLY — IMU sensor data logger for TFLite training dataset collection
import { ImuLoggerScreen } from './src/screens/ImuLoggerScreen';

const MainApp = () => {
  // Navigation & Session State

  const [currentScreen, setCurrentScreen] = useState<ScreenType>('WELCOME');
  const [previousScreenForMap, setPreviousScreenForMap] = useState<ScreenType>('DASHBOARD');
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<UserData | null>(null);
  const [devices, setDevices] = useState<BoundDevice[]>([]);
  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [guardianshipList, setGuardianshipList] = useState<GuardianshipWard[]>([]);
  const [safeZones, setSafeZones] = useState<SafeZone[]>([]);
  const [liveLocation, setLiveLocation] = useState<LocationCoordinates | null>(null);
  const [activeAlert, setActiveAlert] = useState<ApiAlert | null>(null);
  const [isMotionGuardActive, setIsMotionGuardActive] = useState<boolean>(false);
  const [sensitivityMode, setSensitivityMode] = useState<SensitivityMode>('POCKET_GUARD');
  const [isOfflineModalOpen, setIsOfflineModalOpen] = useState(false);
  const [liveEnergyLevel, setLiveEnergyLevel] = useState<number>(0);

  // Grace Countdown Overlay Modal State
  const [isCountdownModalVisible, setIsCountdownModalVisible] = useState<boolean>(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number>(5);
  const [countdownReason, setCountdownReason] = useState<string>('');
  const countdownTimerRef = useRef<any>(null);

  // Form States
  const [contactForm, setContactForm] = useState<ContactFormState>({
    contactName: '',
    contactPhone: '',
    contactEmail: '',
    relationship: 'Friend',
  });
  const [signUpForm, setSignUpForm] = useState<SignUpFormState>({
    fullName: '',
    email: '',
    phoneNumber: '',
    password: '',
    confirmPassword: '',
  });
  const [signInForm, setSignInForm] = useState<SignInFormState>({
    email: '',
    password: '',
  });
  const [deviceForm, setDeviceForm] = useState<DeviceFormState>({
    deviceName: '',
    deviceModel: '',
    imeiNumber: '',
    deviceOs: Platform.OS === 'ios' ? 'iOS' : 'Android',
  });
  const [googlePhoneInput, setGooglePhoneInput] = useState('');

  // Password Visibility Toggle States
  const [showPassword, setShowPassword] = useState(false);
  const [showSignUpPassword, setShowSignUpPassword] = useState(false);
  const [showSignUpConfirmPassword, setShowSignUpConfirmPassword] = useState(false);

  // Tracker Access Portal State
  const [trackerCode, setTrackerCode] = useState('');
  const [totpToken, setTotpToken] = useState('');
  const [trackerSessionToken, setTrackerSessionToken] = useState<string | null>(null);
  const [trackerInfo, setTrackerInfo] = useState<any>(null);
  const [trackerLogs, setTrackerLogs] = useState<any[]>([]);
  const [trackerAudioPlaying, setTrackerAudioPlaying] = useState(false);
  const [audioProgress, setAudioProgress] = useState(0);
  const [trackerConnectionStatus, setTrackerConnectionStatus] = useState<'CONNECTED' | 'RECONNECTING' | 'OFFLINE'>('RECONNECTING');
  const [lastTrackerFixTime, setLastTrackerFixTime] = useState<number | null>(null);
  const [trackerReconnectTrigger, setTrackerReconnectTrigger] = useState<number>(0);
  const socketRef = useRef<any>(null);

  // Feedback Banner State
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // UI Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Pulsing animation for active dashboard SOS button
  useEffect(() => {
    if (currentScreen === 'DASHBOARD') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.12,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 1200,
            useNativeDriver: true,
          }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [currentScreen, pulseAnim]);

  // Fade-in animation for active screen transitions
  useEffect(() => {
    fadeAnim.setValue(0);
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 450,
      useNativeDriver: true,
    }).start();
  }, [currentScreen, fadeAnim]);

  // Load session from AsyncStorage on startup and configure Google Sign-In
  useEffect(() => {
    const loadSession = async () => {
      try {
        const cachedToken = await AsyncStorage.getItem('@safecircle_token');
        const cachedUser = await AsyncStorage.getItem('@safecircle_user');
        if (cachedToken && cachedUser) {
          const parsedUser = JSON.parse(cachedUser);
          setToken(cachedToken);
          setUser(parsedUser);
          if (!parsedUser.phoneNumber || parsedUser.phoneNumber.trim() === '') {
            setCurrentScreen('GOOGLE_PHONE_REGISTER');
          } else {
            setCurrentScreen('DASHBOARD');
          }
        }
      } catch (err) {
        console.log('Error reading cached session:', err);
      }
    };
    loadSession();

    GoogleSignin.configure({
      webClientId: '302894885438-bds6snndbttnu7eu29hjej4u1mq3fp66.apps.googleusercontent.com',
      iosClientId: '342423658982-3sj5f5oiuv6hqduk15mtv69jtet1li4v.apps.googleusercontent.com',
      offlineAccess: true,
    });
  }, []);

  // Helper: Display floating feedback banner
  const triggerFeedback = (message: string, isError: boolean = true) => {
    if (isError) {
      setErrorMessage(message);
      setSuccessMessage(null);
    } else {
      setSuccessMessage(message);
      setErrorMessage(null);
    }
    setTimeout(() => {
      setErrorMessage(null);
      setSuccessMessage(null);
    }, 4000);
  };

  // Auth Handlers
  const handleLocalRegister = async () => {
    const { fullName, email, phoneNumber, password, confirmPassword } = signUpForm;
    if (!fullName || !email || !phoneNumber || !password || !confirmPassword) {
      triggerFeedback('Please fill in all registration fields.');
      return;
    }
    if (password !== confirmPassword) {
      triggerFeedback('Passwords do not match.');
      return;
    }

    setLoading(true);
    const result = await apiService.register({
      fullName,
      email,
      phoneNumber,
      password,
      confirmPassword,
    });
    setLoading(false);

    if (result.success && result.token && result.data) {
      try {
        await AsyncStorage.setItem('@safecircle_token', result.token);
        await AsyncStorage.setItem('@safecircle_user', JSON.stringify(result.data));
      } catch (e) {
        console.log('Session cache error:', e);
      }
      setToken(result.token);
      setUser(result.data);
      setDevices([]);
      setCurrentScreen('DASHBOARD');
      setSignUpForm({
        fullName: '',
        email: '',
        phoneNumber: '',
        password: '',
        confirmPassword: '',
      });
      triggerFeedback('Account created successfully!', false);
    } else {
      triggerFeedback(result.message || 'Registration failed');
    }
  };

  const handleLocalLogin = async () => {
    const { email, password } = signInForm;
    if (!email || !password) {
      triggerFeedback('Please enter both email and password.');
      return;
    }

    setLoading(true);
    const result = await apiService.login({ email, password });
    setLoading(false);

    if (result.success && result.token && result.data) {
      try {
        await AsyncStorage.setItem('@safecircle_token', result.token);
        await AsyncStorage.setItem('@safecircle_user', JSON.stringify(result.data));
      } catch (e) {
        console.log('Session cache error:', e);
      }
      setToken(result.token);
      setUser(result.data);
      setDevices([]);
      setCurrentScreen('DASHBOARD');
      setSignInForm({ email: '', password: '' });
      triggerFeedback('Logged in successfully!', false);
    } else {
      triggerFeedback(result.message || 'Invalid email or password.');
    }
  };

  const handleNativeGoogleLogin = async () => {
    try {
      setLoading(true);
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      try {
        await GoogleSignin.signOut();
      } catch {
        // Ignore error if not previously signed in
      }
      const userInfo = await GoogleSignin.signIn();
      const idToken = userInfo.data?.idToken || (userInfo as any).idToken;

      if (!idToken) {
        throw new Error('Google Sign-In did not return an ID token.');
      }

      const result = await apiService.googleLogin({ idToken });
      setLoading(false);

      if (result.success && result.token && result.data) {
        try {
          await AsyncStorage.setItem('@safecircle_token', result.token);
          await AsyncStorage.setItem('@safecircle_user', JSON.stringify(result.data));
        } catch (e) {
          console.log('Session cache error:', e);
        }
        setToken(result.token);
        setUser(result.data);
        setDevices([]);
        if (result.requiresPhoneNumber || !result.data.phoneNumber || result.data.phoneNumber.trim() === '') {
          setCurrentScreen('GOOGLE_PHONE_REGISTER');
          triggerFeedback('Please register your mobile phone number to complete signup.', false);
        } else {
          setCurrentScreen('DASHBOARD');
          triggerFeedback('Google Login Successful!', false);
        }
      } else {
        triggerFeedback(result.message || 'Google SSO verification failed.');
      }
    } catch (error: any) {
      setLoading(false);
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        console.log('User cancelled Google Sign-In flow');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        console.log('Google Sign-In is already in progress');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        triggerFeedback('Google Play Services are missing or out of date on this device.');
      } else {
        console.log('Native Google Sign-in Error:', error);
        triggerFeedback(error.message || 'Google Sign-In failed.');
      }
    }
  };

  const handleUpdateGooglePhone = async () => {
    if (!googlePhoneInput.trim()) {
      triggerFeedback('Please enter a valid mobile phone number.');
      return;
    }
    if (!token) {
      triggerFeedback('Session expired. Please log in again.');
      setCurrentScreen('WELCOME');
      return;
    }

    try {
      setLoading(true);
      const res = await apiService.updatePhoneNumber(googlePhoneInput.trim(), token);
      setLoading(false);

      if (res.success && res.data) {
        setUser(res.data);
        try {
          await AsyncStorage.setItem('@safecircle_user', JSON.stringify(res.data));
        } catch (e) {
          console.log('Session update error:', e);
        }
        setGooglePhoneInput('');
        triggerFeedback('Phone number registered successfully!', false);
        setCurrentScreen('DASHBOARD');
      } else {
        triggerFeedback(res.message || 'Failed to update phone number.');
      }
    } catch (err: any) {
      setLoading(false);
      triggerFeedback(err.message || 'An error occurred while updating phone number.');
    }
  };

  const handleLogOut = async () => {
    try {
      await AsyncStorage.removeItem('@safecircle_token');
      await AsyncStorage.removeItem('@safecircle_user');
      await GoogleSignin.signOut();
    } catch (e) {
      console.log('Error clearing session cache:', e);
    }
    setToken(null);
    setUser(null);
    setDevices([]);
    setCurrentScreen('WELCOME');
    triggerFeedback('Logged out successfully.', false);
  };

  // Device Handlers
  const handleBindDevice = async () => {
    const { deviceName, deviceModel, imeiNumber, deviceOs } = deviceForm;
    if (!deviceName || !deviceModel || !imeiNumber || !deviceOs) {
      triggerFeedback('All device configuration fields are required.');
      return;
    }
    if (!token) {
      triggerFeedback('Auth session expired. Please log in again.');
      setCurrentScreen('WELCOME');
      return;
    }

    setLoading(true);
    const result = await apiService.bindDevice(token, {
      deviceName,
      deviceModel,
      imeiNumber,
      deviceOs,
    });
    setLoading(false);

    if (result.success && result.data) {
      const newDevice: BoundDevice = {
        id: result.data.id,
        deviceName: result.data.deviceName,
        deviceModel: result.data.deviceModel,
        imeiNumber: result.data.imeiNumber,
        deviceOs: result.data.deviceOs,
        createdAt: result.data.createdAt,
      };

      setDevices(prev => [newDevice, ...prev]);
      setCurrentScreen('DASHBOARD');
      setDeviceForm({
        deviceName: '',
        deviceModel: '',
        imeiNumber: '',
        deviceOs: Platform.OS === 'ios' ? 'iOS' : 'Android',
      });
      triggerFeedback('Device linked successfully!', false);
    } else {
      triggerFeedback(result.message || 'Failed to bind device.');
    }
  };

  const autoDetectDeviceDetails = () => {
    setDeviceForm({
      deviceName: `${Platform.OS === 'ios' ? 'My Simulator' : 'Android Virtual Device'}`,
      deviceModel: Platform.OS === 'ios' ? 'iPhone 15 Pro' : 'Pixel 8 Pro',
      imeiNumber: Math.floor(100000000000000 + Math.random() * 900000000000000).toString(),
      deviceOs: Platform.OS === 'ios' ? 'iOS' : 'Android',
    });
  };

  const handleUnbindDevice = async (deviceId: string) => {
    if (!token) return;
    Alert.alert(
      'Remove Device',
      'Are you sure you want to unbind this device from your account?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unbind',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const result = await apiService.unbindDevice(token, deviceId);
            setLoading(false);
            if (result.success) {
              setDevices(prev => prev.filter(d => d.id !== deviceId));
              triggerFeedback('Device unbound successfully.', false);
            } else {
              triggerFeedback(result.message || 'Failed to unbind device.');
            }
          },
        },
      ]
    );
  };

  useEffect(() => {
    if (token) {
      const loadInitialData = async () => {
        setLoading(true);
        const [cRes, dRes, aRes, zRes, gRes] = await Promise.all([
          apiService.getContacts(token),
          apiService.getDevices(token),
          apiService.getActiveAlerts(token),
          apiService.getSafeZones(token),
          apiService.getGuardianshipList(token),
        ]);
        setLoading(false);

        if (cRes.success && cRes.data) {
          setContacts(cRes.data);
        } else if (!cRes.success) {
          triggerFeedback(cRes.message || 'Failed to load safety contacts.');
        }

        if (gRes.success && gRes.data) {
          setGuardianshipList(gRes.data);
        }

        if (dRes.success && dRes.data) {
          const mappedDevices = dRes.data.map((d: any) => ({
            id: d.id,
            deviceName: d.deviceName,
            deviceModel: d.deviceModel,
            imeiNumber: d.imeiNumber,
            deviceOs: d.deviceOs,
            createdAt: d.createdAt,
          }));
          setDevices(mappedDevices);
        } else if (!dRes.success) {
          triggerFeedback(dRes.message || 'Failed to load registered devices.');
        }

        if (aRes.success && aRes.data && aRes.data.length > 0) {
          setActiveAlert(aRes.data[0]);
        } else {
          setActiveAlert(null);
        }

        if (zRes.success && zRes.data) {
          setSafeZones(zRes.data);
        }
      };
      loadInitialData();
    } else {
      setContacts([]);
      setGuardianshipList([]);
      setDevices([]);
      setSafeZones([]);
      setActiveAlert(null);
    }
  }, [token]);

  // Safe Zone Handlers
  const handleCreateSafeZone = async (
    zoneName: string,
    radiusMeters: number,
    customLat?: number,
    customLng?: number
  ) => {
    if (!token) return;

    let targetLat = customLat !== undefined ? customLat : liveLocation?.latitude;
    let targetLng = customLng !== undefined ? customLng : liveLocation?.longitude;

    if (targetLat === undefined || targetLng === undefined || targetLat === null || targetLng === null) {
      setLoading(true);
      const loc = await locationService.getCurrentLocation();
      setLoading(false);
      if (loc) {
        targetLat = loc.latitude;
        targetLng = loc.longitude;
      }
    }

    if (targetLat === undefined || targetLng === undefined || targetLat === null || targetLng === null) {
      triggerFeedback('Could not fetch GPS location to create safe zone. Please enable GPS location services.');
      return;
    }

    setLoading(true);
    const result = await apiService.createSafeZone(token, {
      zoneName,
      latitude: targetLat,
      longitude: targetLng,
      radiusMeters,
    });
    setLoading(false);

    if (result.success && result.data) {
      setSafeZones(prev => [result.data!, ...prev]);
      triggerFeedback(`Safe Zone "${zoneName}" (${radiusMeters}m) created!`, false);
    } else {
      triggerFeedback(result.message || 'Failed to create safe zone.');
    }
  };


  const handleDeleteSafeZone = async (safeZoneId: string) => {
    if (!token) return;
    Alert.alert(
      'Remove Safe Zone',
      'Are you sure you want to remove this Safe Zone geofence?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const result = await apiService.deleteSafeZone(token, safeZoneId);
            setLoading(false);
            if (result.success) {
              setSafeZones(prev => prev.filter(z => z.id !== safeZoneId));
              triggerFeedback('Safe Zone removed successfully.', false);
            } else {
              triggerFeedback(result.message || 'Failed to delete safe zone.');
            }
          },
        },
      ]
    );
  };

  // Motion Guard Toggle & Sensor Anomaly Handler
  const handleToggleMotionGuard = (active: boolean) => {
    if (active) {
      const started = motionService.startMonitoring(
        (anomaly) => {
          // Trigger 5-Second Grace Cancellation Countdown Overlay
          setCountdownReason(anomaly.reason);
          setCountdownSeconds(5);
          setIsCountdownModalVisible(true);
          try { Vibration.vibrate([0, 500, 200, 500]); } catch (e) { }
          soundService.getSelectedSound().then(snd => soundService.playSound(snd));

          if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
          countdownTimerRef.current = setInterval(() => {
            setCountdownSeconds((prev) => {
              if (prev <= 1) {
                clearInterval(countdownTimerRef.current);
                setIsCountdownModalVisible(false);
                soundService.stopSound();
                triggerSosSignal(); // Auto-fire emergency SOS broadcast if not cancelled!
                return 0;
              }
              try { Vibration.vibrate(200); } catch (e) { }
              return prev - 1;
            });
          }, 1000);
        },
        (energyLevel) => {
          setLiveEnergyLevel(energyLevel);
        }
      );

      if (started) {
        setIsMotionGuardActive(true);
        triggerFeedback('🛡️ Motion Theft Guard activated at 50Hz sensor rate.', false);
      } else {
        setIsMotionGuardActive(false);
        triggerFeedback('Could not activate motion sensors on this device.');
      }
    } else {
      motionService.stopMonitoring();
      setIsMotionGuardActive(false);
      setLiveEnergyLevel(0);
      soundService.stopSound();
      triggerFeedback('Motion Theft Guard deactivated.', false);
    }
  };

  const handleCancelCountdown = () => {
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
    }
    setIsCountdownModalVisible(false);
    soundService.stopSound();
    triggerFeedback('Emergency SOS cancelled. Device marked safe.', false);
  };

  const handleSelectSensitivityMode = (mode: SensitivityMode) => {
    setSensitivityMode(mode);
    motionService.setSensitivityMode(mode);
    triggerFeedback(`Sensitivity updated to ${mode.replace('_', ' ')}`, false);
  };

  // Initialize FCM Push Notifications when authenticated
  useEffect(() => {
    if (token) {
      fcmService.initialize(token, () => {
        setCurrentScreen('TRACKER_DASHBOARD');
      });
    }
  }, [token]);

  const handleCalibrateBaseline = () => {
    triggerFeedback('🎯 Calibrating 3-second baseline... Keep device still / walking normally', false);
    motionService.calibrateUserBaseline((offset) => {
      triggerFeedback(`✅ Baseline calibrated! Offset: ${offset} m/s²`, false);
    });
  };

  // Fetch current GPS position on demand
  const handleFetchCurrentLocation = async () => {
    setLoading(true);
    const loc = await locationService.getCurrentLocation();
    setLoading(false);
    if (loc) {
      setLiveLocation(loc);
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('location_update', {
          deviceId: devices[0]?.id || '00000000-0000-0000-0000-000000000000',
          ...loc,
        });
      }
      triggerFeedback(`📍 Current Location updated: ${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)}`, false);
    } else {
      triggerFeedback('Could not fetch current location. Please check device GPS permissions.');
    }
  };

  // Real-Time GPS location tracking using Google Fused Location Provider API & WebSockets
  useEffect(() => {
    if (token && currentScreen === 'DASHBOARD') {
      const targetDeviceId = devices.length > 0 && devices[0].id ? devices[0].id : '00000000-0000-0000-0000-000000000000';
      console.log(`[Fused Location Provider] Initializing live GPS tracking for device ID: ${targetDeviceId}`);

      // Ensure Socket.IO client instance exists for socket emission
      if (!socketRef.current) {
        socketRef.current = io(API_BASE_URL, {
          transports: ['websocket'],
          forceNew: true,
          auth: { token },
        });
      }

      locationService.startLocationTracking(
        targetDeviceId,
        token,
        socketRef.current,
        (location) => {
          setLiveLocation(location);
        }
      );

      locationService.setTrackingMode(activeAlert ? 'EMERGENCY_SOS' : 'PASSIVE_MONITORING');

      // FIX Phase 3: Subscribe to native FusedLocation events from MotionForegroundService.
      // These events come from Kotlin via DeviceEventEmitter and keep flowing even when
      // Android throttles the JS thread. They are dispatched over the same socket channel
      // so the server receives a continuous stream regardless of screen/Doze state.
      locationService.subscribeToNativeLocationUpdates(
        targetDeviceId,
        token,
        socketRef.current,
        (location) => setLiveLocation(location)
      );
    } else {
      locationService.stopLocationTracking();
    }

    return () => {
      locationService.stopLocationTracking();
    };
  }, [token, currentScreen, devices, activeAlert]);

  // Safety Circle Contact Handlers
  const handleAddContact = async () => {
    const { contactName, contactPhone, contactEmail, relationship } = contactForm;
    if (!contactName || !contactPhone) {
      triggerFeedback('Contact name and phone number are required.');
      return;
    }
    if (!token) {
      triggerFeedback('Auth session expired. Please log in again.');
      setCurrentScreen('WELCOME');
      return;
    }

    setLoading(true);
    const result = await apiService.addContact(token, {
      contactName,
      contactPhone,
      contactEmail: contactEmail.trim() || undefined,
      relationship,
    });
    setLoading(false);

    if (result.success && result.data) {
      const newContact = result.data;
      const delivery = result.delivery;
      const accessCode = newContact.accessCode;

      setContacts(prev => [newContact, ...prev]);
      setCurrentScreen('DASHBOARD');
      setContactForm({
        contactName: '',
        contactPhone: '',
        contactEmail: '',
        relationship: 'Friend',
      });

      const shareInvitation = async () => {
        try {
          const totpUri = result.totpProvisioningUri || '';
          const shareMsg = `🚨 SafeCircle Emergency Network 🚨\n\nI have added you (${contactName}) as my trusted emergency guardian on SafeCircle.\n\nYour Contact Handle: ${accessCode}\n\nTo configure your 2FA authenticator (Google Authenticator / Authy), open this link on your phone:\n${totpUri}\n\nIn an emergency, view my live radar location and audio evidence here:\nhttps://safecircle.app/track?code=${accessCode}`;
          await Share.share({
            title: 'SafeCircle Guardian Access & Security Setup',
            message: shareMsg,
          });
        } catch (e: any) {
          console.warn('Share error:', e);
        }
      };

      if (delivery?.isRegisteredUser) {
        // Priority 1: Contact is an active SafeCircle member -> In-App Push Notification
        Alert.alert(
          '🛡️ Member Connected!',
          `✅ ${contactName} is already a registered SafeCircle member!\n\nAn in-app notification has been dispatched to their device and they can see you under "People I Protect". No manual code entry is required.`,
          [{ text: 'Great!' }]
        );
      } else if (delivery?.deliveryChannel === 'EMAIL_INVITATION') {
        // Priority 2: Contact is not registered, but email was provided -> Email sent
        Alert.alert(
          '✉️ Guardian Invitation Dispatched!',
          `An official SafeCircle email with Guardian Handle (${accessCode}) and TOTP Authenticator setup QR code was sent to ${contactEmail.trim()}.\n\nWould you also like to share the setup link directly via WhatsApp or SMS?`,
          [
            { text: 'Done', style: 'cancel' },
            {
              text: '📲 Share via WhatsApp / SMS',
              onPress: shareInvitation,
            },
          ]
        );
      } else {
        // Priority 3: Contact is not registered, no email provided -> Direct Share
        Alert.alert(
          '🛡️ Guardian Handle Generated',
          `${contactName} is not yet on SafeCircle.\n\nTheir Guardian Handle is: ${accessCode}\n\nShare their 2FA setup link with them so they can securely track your device during an emergency SOS.`,
          [
            { text: 'Later', style: 'cancel' },
            {
              text: '📲 Share Setup Link Now',
              onPress: shareInvitation,
            },
          ]
        );
      }
    } else {
      triggerFeedback(result.message || 'Failed to add contact.');
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!token) return;
    Alert.alert(
      'Remove Contact',
      'Are you sure you want to remove this contact from your safety circle?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            const result = await apiService.deleteContact(token, contactId);
            setLoading(false);
            if (result.success) {
              setContacts(prev => prev.filter(c => c.id !== contactId));
              triggerFeedback('Contact removed successfully.', false);
            } else {
              triggerFeedback(result.message || 'Failed to remove contact.');
            }
          },
        },
      ]
    );
  };

  const handleToggleSharingMode = async (contactId: string, currentMode: 'EMERGENCY_ONLY' | 'ALWAYS_ON') => {
    if (!token) return;
    const newMode = currentMode === 'ALWAYS_ON' ? 'EMERGENCY_ONLY' : 'ALWAYS_ON';
    setLoading(true);
    const result = await apiService.updateContactSharingMode(token, contactId, newMode);
    setLoading(false);

    if (result.success && result.data) {
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, sharingMode: newMode } : c));
      const modeLabel = newMode === 'ALWAYS_ON' ? '🌐 Always-On Family Sharing' : '🔒 Emergency-Only SOS Sharing';
      triggerFeedback(`Location sharing updated to: ${modeLabel}`, false);
    } else {
      triggerFeedback(result.message || 'Failed to update contact sharing mode.');
    }
  };

  // SOS Signal Handlers
  const triggerSosSignal = async () => {
    if (!token) return;

    let sosLat = liveLocation?.latitude;
    let sosLng = liveLocation?.longitude;

    if (sosLat === undefined || sosLng === undefined || sosLat === null || sosLng === null) {
      setLoading(true);
      const loc = await locationService.getCurrentLocation();
      setLoading(false);
      if (loc) {
        sosLat = loc.latitude;
        sosLng = loc.longitude;
      }
    }

    setLoading(true);
    const result = await apiService.triggerAlert(token, {
      alertType: 'SOS',
      deviceId: devices[0]?.id || undefined,
      latitude: sosLat !== undefined && sosLat !== null ? sosLat : undefined,
      longitude: sosLng !== undefined && sosLng !== null ? sosLng : undefined,
    });
    setLoading(false);

    if (result.success && result.data) {
      const activeAlertData = result.data;
      setActiveAlert(activeAlertData);
      locationService.setTrackingMode('EMERGENCY_SOS');
      triggerFeedback('SOS Alert triggered! Safety contacts notified.', false);

      setTimeout(async () => {
        let audioToUpload: any = null;

        // FIX Stage 2: Capture real 5-second ambient microphone recording via native AudioRecorderModule
        if (Platform.OS === 'android' && NativeModules.AudioRecorderModule) {
          try {
            console.log('[SOS Auto-Record] 🎙️ Starting 5s real ambient audio recording from microphone...');
            const recorded = await NativeModules.AudioRecorderModule.recordAmbientAudio(5);
            if (recorded && recorded.uri) {
              audioToUpload = {
                uri: recorded.uri,
                type: recorded.type || 'audio/m4a',
                name: recorded.name || `sos-auto-ambient-${activeAlertData.id.slice(-4)}.m4a`,
              };
              console.log('[SOS Auto-Record] ✅ Real microphone recording completed:', recorded.uri);
            }
          } catch (recErr: any) {
            console.warn('[SOS Auto-Record] Native recording error, falling back:', recErr.message);
          }
        }

        if (!audioToUpload) {
          audioToUpload = {
            uri: 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGFtZTMuOTguNFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
            type: 'audio/mp3',
            name: `sos-auto-ambient-${activeAlertData.id.slice(-4)}.mp3`,
          };
        }

        await apiService.uploadAmbientAudio(token, activeAlertData.id, audioToUpload);

        const activeRes = await apiService.getActiveAlerts(token);
        if (activeRes.success && activeRes.data && activeRes.data.length > 0) {
          setActiveAlert(activeRes.data[0]);
        }
      }, 500);
    } else {
      triggerFeedback(result.message || 'Failed to trigger SOS alert.');
    }
  };

  const handleUploadAmbientAudio = async () => {
    if (!token || !activeAlert) return;
    setLoading(true);

    let audioToUpload: any = null;

    if (Platform.OS === 'android' && NativeModules.AudioRecorderModule) {
      try {
        triggerFeedback('🎙️ Recording 5s ambient evidence from microphone...', false);
        const recorded = await NativeModules.AudioRecorderModule.recordAmbientAudio(5);
        if (recorded && recorded.uri) {
          audioToUpload = {
            uri: recorded.uri,
            type: recorded.type || 'audio/m4a',
            name: recorded.name || `ambient-sos-snapshot-${Date.now().toString().slice(-4)}.m4a`,
          };
        }
      } catch (recErr: any) {
        console.warn('[Ambient Audio] Native recording error, falling back:', recErr.message);
      }
    }

    if (!audioToUpload) {
      audioToUpload = {
        uri: 'data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGFtZTMuOTguNFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV',
        type: 'audio/mp3',
        name: `ambient-sos-snapshot-${Date.now().toString().slice(-4)}.mp3`,
      };
    }

    const result = await apiService.uploadAmbientAudio(token, activeAlert.id, audioToUpload);
    setLoading(false);

    if (result.success && result.data) {
      setActiveAlert(result.data);
      triggerFeedback('Ambient safety audio uploaded successfully!', false);
    } else {
      triggerFeedback(result.message || 'Failed to upload ambient audio.');
    }
  };

  const handleResolveAlert = async () => {
    if (!token || !activeAlert) return;

    setLoading(true);
    const result = await apiService.resolveAlert(token, activeAlert.id);
    setLoading(false);

    if (result.success) {
      setActiveAlert(null);
      locationService.setTrackingMode('PASSIVE_MONITORING');
      triggerFeedback('SOS Alert resolved. You are marked as safe.', false);
    } else {
      triggerFeedback(result.message || 'Failed to resolve SOS alert.');
    }
  };

  // Tracker Portal Handlers & Effects
  const handleVerifyTrackerCode = async (codeStr?: string, tokenStr?: string) => {
    const code  = codeStr  || trackerCode;
    const token = tokenStr || totpToken;

    if (!code) {
      triggerFeedback('Please enter your Contact Handle (e.g. SC-A3F2B1C9).');
      return;
    }
    if (!token || token.length !== 6) {
      triggerFeedback('Please enter the 6-digit authentication code from your authenticator app.');
      return;
    }

    setLoading(true);
    const result = await apiService.verifyAccessCode(code, token);
    setLoading(false);

    if (result.success && result.data) {
      const isAlwaysOn = result.data.sharingMode === 'ALWAYS_ON';
      if (!result.data.isActiveSos && !isAlwaysOn) {
        triggerFeedback('Access Denied: Location sharing is set to Emergency-Only and the user is not currently in an active SOS emergency state.');
        return;
      }
      setTrackerInfo(result.data);
      if (result.trackerSessionToken) {
        setTrackerSessionToken(result.trackerSessionToken);
      }

      const logResult = await apiService.getSharedLocationHistory(code, result.trackerSessionToken);
      if (logResult.success && logResult.data) {
        setTrackerLogs(logResult.data);
        if (logResult.data.length > 0) {
          setLastTrackerFixTime(Date.now());
        }
      }
      setCurrentScreen('TRACKER_DASHBOARD');
      triggerFeedback('Secure connection established!', false);
    } else {
      triggerFeedback(result.message || 'Access Denied: Invalid contact handle or authentication code.');
    }
  };

  useEffect(() => {
    let intervalId: any = null;
    if (currentScreen === 'TRACKER_DASHBOARD' && trackerInfo && trackerSessionToken) {
      const pollTrackerUpdates = async () => {
        // Authenticated polling using 2-hour Tracker Session JWT
        const statusRes = await apiService.getTrackerSessionStatus(trackerSessionToken);
        if (statusRes.success && statusRes.data) {
          const isAlwaysOn = statusRes.data.sharingMode === 'ALWAYS_ON';
          if (!statusRes.data.isActiveSos && !isAlwaysOn) {
            triggerFeedback('Emergency SOS has been resolved by the user.', false);
            setCurrentScreen('WELCOME');
            setTrackerInfo(null);
            setTrackerSessionToken(null);
            setTrackerLogs([]);
            setLastTrackerFixTime(null);
            return;
          }
          setTrackerInfo(statusRes.data);
          if (statusRes.data.isActiveSos) {
            setTrackerConnectionStatus('CONNECTED');
          }
        } else if (!statusRes.success) {
          console.warn('[Tracker Polling] Session update failed:', statusRes.message);
        }
      };

      pollTrackerUpdates();
      intervalId = setInterval(pollTrackerUpdates, 8000);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [currentScreen, trackerInfo, trackerSessionToken]);

  useEffect(() => {
    if (currentScreen === 'TRACKER_DASHBOARD' && trackerInfo && trackerInfo.deviceId) {
      const deviceId = trackerInfo.deviceId;
      console.log(`Connecting to WebSocket Server at ${API_BASE_URL} for device: ${deviceId}`);
      setTrackerConnectionStatus('RECONNECTING');

      const socket = io(API_BASE_URL, {
        transports: ['websocket'],
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 20,
        reconnectionDelay: 2000,
        auth: { token: trackerSessionToken },
      });

      socket.on('connect_error', (err) => {
        console.warn('[Socket.IO Tracker] Connection error:', err.message);
        setTrackerConnectionStatus('OFFLINE');
      });

      socket.io.on('reconnect_attempt', () => {
        setTrackerConnectionStatus('RECONNECTING');
      });

      socket.io.on('reconnect_failed', () => {
        setTrackerConnectionStatus('OFFLINE');
      });

      socket.on('connect', () => {
        console.log('WebSocket Connected successfully! Joining device room:', deviceId);
        setTrackerConnectionStatus('CONNECTED');
        socket.emit('join-device-room', { deviceId });
      });

      socket.on('location-broadcast', (newLog: any) => {
        console.log('Received location-broadcast event via WebSocket:', newLog);
        if (newLog) {
          setLastTrackerFixTime(Date.now());
          setTrackerConnectionStatus('CONNECTED');
          setTrackerLogs(prevLogs => {
            const exists = prevLogs.some(log => (log.id && log.id === newLog.id) || log.timestamp === newLog.timestamp);
            if (exists) return prevLogs;
            return [newLog, ...prevLogs];
          });
        }
      });

      socket.on('device_heartbeat', (data: any) => {
        console.log('Received device_heartbeat event via WebSocket:', data);
        setLastTrackerFixTime(Date.now());
        setTrackerConnectionStatus('CONNECTED');
      });

      socket.on('disconnect', (reason) => {
        console.log('WebSocket Disconnected:', reason);
        setTrackerConnectionStatus('OFFLINE');
      });

      socketRef.current = socket;

      return () => {
        console.log('Cleaning up WebSocket connection for device:', deviceId);
        if (socket) {
          socket.disconnect();
        }
        socketRef.current = null;
      };
    }
  }, [currentScreen, trackerInfo, trackerSessionToken, trackerReconnectTrigger]);

  const handleReconnectTrackerSocket = () => {
    setTrackerConnectionStatus('RECONNECTING');
    setTrackerReconnectTrigger(prev => prev + 1);
    triggerFeedback('Attempting to re-establish live WebSocket stream...', false);
  };

  useEffect(() => {
    let intervalId: any = null;
    if (trackerAudioPlaying) {
      intervalId = setInterval(() => {
        setAudioProgress(prev => {
          if (prev >= 100) {
            setTrackerAudioPlaying(false);
            return 0;
          }
          return prev + 5;
        });
      }, 500);
    } else {
      if (intervalId) clearInterval(intervalId);
    }
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [trackerAudioPlaying]);

  return (
    <SafeAreaView style={globalStyles.safeArea}>
      <FeedbackBanner errorMessage={errorMessage} successMessage={successMessage} />

      <Animated.View style={[globalStyles.container, { opacity: fadeAnim }]}>
        {currentScreen === 'WELCOME' && (
          <WelcomeScreen
            signInForm={signInForm}
            setSignInForm={setSignInForm}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            loading={loading}
            onLocalLogin={handleLocalLogin}
            onNativeGoogleLogin={handleNativeGoogleLogin}
            onNavigateSignUp={() => setCurrentScreen('SIGNUP')}
            onNavigateTrackerAuth={() => {
              setTrackerCode('');
              setTrackerSessionToken(null);
              setTrackerInfo(null);
              setTrackerLogs([]);
              setCurrentScreen('TRACKER_AUTH');
            }}
          />
        )}

        {currentScreen === 'SIGNUP' && (
          <SignUpScreen
            signUpForm={signUpForm}
            setSignUpForm={setSignUpForm}
            showSignUpPassword={showSignUpPassword}
            setShowSignUpPassword={setShowSignUpPassword}
            showSignUpConfirmPassword={showSignUpConfirmPassword}
            setShowSignUpConfirmPassword={setShowSignUpConfirmPassword}
            loading={loading}
            onLocalRegister={handleLocalRegister}
            onNavigateWelcome={() => setCurrentScreen('WELCOME')}
          />
        )}

        {currentScreen === 'GOOGLE_PHONE_REGISTER' && (
          <GooglePhoneRegisterScreen
            user={user}
            googlePhoneInput={googlePhoneInput}
            setGooglePhoneInput={setGooglePhoneInput}
            loading={loading}
            onUpdateGooglePhone={handleUpdateGooglePhone}
            onCancel={() => {
              setToken(null);
              setUser(null);
              AsyncStorage.removeItem('@safecircle_token');
              AsyncStorage.removeItem('@safecircle_user');
              setCurrentScreen('WELCOME');
            }}
          />
        )}

        {currentScreen === 'DASHBOARD' && (
          <DashboardScreen
            user={user}
            userToken={token}
            devices={devices}
            contacts={contacts}
            safeZones={safeZones}
            activeAlert={activeAlert}
            liveLocation={liveLocation}
            isMotionGuardActive={isMotionGuardActive}
            sensitivityMode={sensitivityMode}
            liveEnergyLevel={liveEnergyLevel}
            pulseAnim={pulseAnim}
            loading={loading}
            onLogOut={handleLogOut}
            onTriggerSos={triggerSosSignal}
            onResolveAlert={handleResolveAlert}
            onUploadAmbientAudio={handleUploadAmbientAudio}
            onNavigateBindDevice={() => setCurrentScreen('BIND_DEVICE')}
            onNavigateAddContact={() => setCurrentScreen('ADD_CONTACT')}
            onNavigateFullScreenMap={() => {
              setPreviousScreenForMap('DASHBOARD');
              setCurrentScreen('FULLSCREEN_MAP');
            }}
            onFetchCurrentLocation={handleFetchCurrentLocation}
            onCreateSafeZone={handleCreateSafeZone}
            onDeleteSafeZone={handleDeleteSafeZone}
            onToggleMotionGuard={handleToggleMotionGuard}
            onSelectSensitivityMode={handleSelectSensitivityMode}
            onCalibrateBaseline={handleCalibrateBaseline}
            onUnbindDevice={handleUnbindDevice}
            onDeleteContact={handleDeleteContact}
            onToggleSharingMode={handleToggleSharingMode}
            guardianshipList={guardianshipList}
            onTrackWard={(accessCode: string) => {
              setTrackerCode(accessCode);
              handleVerifyTrackerCode(accessCode);
            }}
          onOpenOfflineModal={() => setIsOfflineModalOpen(true)}
          />
        )}

        {/* DEV ONLY — IMU Data Logger entry button (invisible in production builds) */}
        {__DEV__ && currentScreen === 'DASHBOARD' && (
          <TouchableOpacity
            onPress={() => setCurrentScreen('IMU_LOGGER')}
            style={{
              position: 'absolute',
              bottom: 16,
              right: 16,
              backgroundColor: '#7c2d12',
              borderRadius: 24,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderWidth: 1,
              borderColor: '#ea580c',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              elevation: 8,
              zIndex: 999,
            }}
            activeOpacity={0.8}
          >
            <Text style={{ fontSize: 14 }}>🔬</Text>
            <Text style={{ color: '#fed7aa', fontSize: 11, fontWeight: '800' }}>Logger</Text>
          </TouchableOpacity>
        )}

        {/* Grace Cancellation Emergency Countdown Overlay Modal */}
        <Modal
          visible={isCountdownModalVisible}
          transparent={true}
          animationType="slide"
          onRequestClose={handleCancelCountdown}
        >
          <View style={{
            flex: 1,
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 24,
          }}>
            <View style={{
              width: '100%',
              backgroundColor: '#7F1D1D',
              borderRadius: 24,
              padding: 28,
              alignItems: 'center',
              borderWidth: 2,
              borderColor: '#EF4444',
            }}>
              <Text style={{ fontSize: 48, marginBottom: 8 }}>🚨</Text>
              <Text style={{ color: '#FFF', fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: 6 }}>
                THEFT ANOMALY DETECTED!
              </Text>
              <Text style={{ color: '#FCA5A5', fontSize: 13, textAlign: 'center', marginBottom: 20, lineHeight: 18 }}>
                {countdownReason || 'Uncharacteristic violent snatch pattern detected.'}
              </Text>

              {/* Pulsing Seconds Number Circle */}
              <View style={{
                width: 90,
                height: 90,
                borderRadius: 45,
                backgroundColor: '#EF4444',
                justifyContent: 'center',
                alignItems: 'center',
                marginBottom: 20,
                borderWidth: 4,
                borderColor: '#FFF',
              }}>
                <Text style={{ color: '#FFF', fontSize: 44, fontWeight: '900' }}>
                  {countdownSeconds}
                </Text>
              </View>

              <Text style={{ color: '#FFF', fontSize: 12, fontWeight: '600', marginBottom: 24, textAlign: 'center' }}>
                Broadcasting Emergency SOS to Safety Circle in {countdownSeconds} seconds...
              </Text>

              {/* Cancel False Alarm Button */}
              <TouchableOpacity
                style={{
                  width: '100%',
                  backgroundColor: '#0F172A',
                  paddingVertical: 16,
                  borderRadius: 14,
                  alignItems: 'center',
                  borderWidth: 2,
                  borderColor: '#38BDF8',
                }}
                onPress={handleCancelCountdown}
              >
                <Text style={{ color: '#38BDF8', fontSize: 16, fontWeight: '800' }}>
                  ✋ CANCEL ALERT (False Alarm)
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {currentScreen === 'BIND_DEVICE' && (
          <BindDeviceScreen
            deviceForm={deviceForm}
            setDeviceForm={setDeviceForm}
            loading={loading}
            onBindDevice={handleBindDevice}
            onAutoDetect={autoDetectDeviceDetails}
            onNavigateDashboard={() => setCurrentScreen('DASHBOARD')}
          />
        )}

        {currentScreen === 'ADD_CONTACT' && (
          <AddContactScreen
            contactForm={contactForm}
            setContactForm={setContactForm}
            loading={loading}
            onAddContact={handleAddContact}
            onNavigateDashboard={() => setCurrentScreen('DASHBOARD')}
          />
        )}

        {currentScreen === 'TRACKER_AUTH' && (
          <TrackerAuthScreen
            trackerCode={trackerCode}
            setTrackerCode={setTrackerCode}
            totpToken={totpToken}
            setTotpToken={setTotpToken}
            loading={loading}
            onVerifyTrackerCode={handleVerifyTrackerCode}
            onNavigateWelcome={() => setCurrentScreen('WELCOME')}
          />
        )}

        {currentScreen === 'TRACKER_DASHBOARD' && trackerInfo && (
          <TrackerDashboardScreen
            trackerInfo={trackerInfo}
            trackerLogs={trackerLogs}
            trackerAudioPlaying={trackerAudioPlaying}
            audioProgress={audioProgress}
            connectionStatus={trackerConnectionStatus}
            lastFixTimestamp={lastTrackerFixTime}
            onToggleAudioPlaying={() => setTrackerAudioPlaying(!trackerAudioPlaying)}
            onNavigateFullScreenMap={() => {
              setPreviousScreenForMap('TRACKER_DASHBOARD');
              setCurrentScreen('FULLSCREEN_MAP');
            }}
            onNavigateARView={() => {
              setPreviousScreenForMap('TRACKER_DASHBOARD');
              setCurrentScreen('AR_VIEW');
            }}
            onReconnect={handleReconnectTrackerSocket}
            onDisconnect={() => {
              setCurrentScreen('WELCOME');
              setTrackerInfo(null);
              setTrackerSessionToken(null);
              setTrackerLogs([]);
              setLastTrackerFixTime(null);
            }}
          />
        )}

        {currentScreen === 'FULLSCREEN_MAP' && (
          <TacticalSplitMapScreen
            liveLocation={
              previousScreenForMap === 'TRACKER_DASHBOARD' && trackerLogs.length > 0
                ? {
                  latitude: parseFloat(trackerLogs[0].latitude),
                  longitude: parseFloat(trackerLogs[0].longitude),
                  accuracy: trackerLogs[0].accuracy ? parseFloat(trackerLogs[0].accuracy) : 5.0,
                  speed: trackerLogs[0].speed ? parseFloat(trackerLogs[0].speed) : 0,
                  heading: trackerLogs[0].heading ? parseFloat(trackerLogs[0].heading) : 0,
                  altitude: 0,
                  timestamp: trackerLogs[0].timestamp || new Date().toISOString(),
                }
                : liveLocation
            }
            safeZones={safeZones}
            activeAlert={activeAlert}
            isMotionGuardActive={isMotionGuardActive}
            onBack={() => setCurrentScreen(previousScreenForMap || 'DASHBOARD')}
            onRecenter={handleFetchCurrentLocation}
            onTriggerSos={triggerSosSignal}
            onToggleMotionGuard={handleToggleMotionGuard}
            onNavigateARView={() => setCurrentScreen('AR_VIEW')}
            onCreateSafeZone={handleCreateSafeZone}
            onOpenOfflineModal={() => setIsOfflineModalOpen(true)}
          />
        )}


        {/* DEV ONLY — IMU Sensor Data Logger Screen */}
        {__DEV__ && currentScreen === 'IMU_LOGGER' && (
          <ImuLoggerScreen onBack={() => setCurrentScreen('DASHBOARD')} />
        )}

        {currentScreen === 'AR_VIEW' && (
          <ARViewComponent
            userLatitude={liveLocation?.latitude ?? null}
            userLongitude={liveLocation?.longitude ?? null}
            targetLatitude={
              previousScreenForMap === 'TRACKER_DASHBOARD' && trackerLogs.length > 0
                ? parseFloat(trackerLogs[0].latitude)
                : activeAlert && activeAlert.latitude
                  ? parseFloat(String(activeAlert.latitude))
                  : null
            }
            targetLongitude={
              previousScreenForMap === 'TRACKER_DASHBOARD' && trackerLogs.length > 0
                ? parseFloat(trackerLogs[0].longitude)
                : activeAlert && activeAlert.longitude
                  ? parseFloat(String(activeAlert.longitude))
                  : null
            }
            targetName={
              previousScreenForMap === 'TRACKER_DASHBOARD' && trackerInfo
                ? trackerInfo.targetUser.fullName
                : user?.fullName || 'Target Device'
            }
            onBack={() => setCurrentScreen('FULLSCREEN_MAP')}
          />
        )}
      </Animated.View>

      {/* Offline Vector Tile Pack Downloader Modal (Thesis Figure 5.8 / Sec 5.2.3) */}
      <OfflinePackModal
        visible={isOfflineModalOpen}
        latitude={liveLocation?.latitude}
        longitude={liveLocation?.longitude}
        onClose={() => setIsOfflineModalOpen(false)}
      />
    </SafeAreaView>
  );
};

const App = () => {
  return (
    <ThemeProvider>
      <MainApp />
    </ThemeProvider>
  );
};

export default App;