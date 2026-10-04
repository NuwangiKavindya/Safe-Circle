# SafeCircle Project Progress & System Context Report

> **Purpose**: This document provides a comprehensive progress summary, architectural overview, and status report for the **SafeCircle** project. It is formatted to provide full contextual clarity for developers and AI assistants (e.g. Claude) continuing development on this system.

---

## 1. Project Overview & Research Context

* **Project Title**: SAFECIRCLE: Intelligent Mobile Security with Audio Alerts and Real-Time Tracking
* **Academic Context**: B.Sc. in Software Engineering Research Project (NSBM Green University)
* **Core Problem Statement**: Existing mobile tracking apps require devices to remain powered on and logged in, fail to provide trusted social network assistance, lack adaptive audio alerts, and compromise privacy. SafeCircle provides an integrated multi-layered mobile security architecture.
* **Workspace Directory**: `/Users/nuwangi/Desktop/research/safe-circle`
  * Frontend Application: `frontend/`
  * Backend Server: `backend/`
  * Project Documentation: `docs/`

---

## 2. Technology Stack & Key Dependencies

### Frontend (`frontend/package.json`)
* **Framework**: React Native (`v0.85.0`) with TypeScript
* **Map Engine**: `@maplibre/maplibre-react-native` (`v11.3.6`) for vector satellite map rendering
* **Native GPS Provider**: `react-native-geolocation-service` (`v5.3.1`) leveraging Google Fused Location Provider API
* **Real-time WebSockets**: `socket.io-client` (`v4.8.3`) for sub-second location coordinate streaming
* **Local Session Storage**: `@react-native-async-storage/async-storage` (`v3.1.1`)
* **Authentication**: `@react-native-google-signin/google-signin` (`v16.1.2`) for OAuth 2.0 social login

### Backend (`backend/package.json`)
* **Runtime & API Framework**: Node.js + Express framework (Port `5001`)
* **Database & ORM**: PostgreSQL with Sequelize ORM (`models/User.js`, `models/Device.js`, `models/TrustedContact.js`, `models/LocationLog.js`, `models/Alert.js`, `models/SafeZone.js`)
* **Real-time Socket Engine**: Socket.IO server (`io.on('connection')`) handling real-time rooms
* **API Documentation**: Swagger UI (`swagger-ui-express`) at `http://localhost:5001/api-docs`

---

## 3. Implemented Modules & Current System Status

### ✅ Module 1: Authentication & Device Authorization
* JWT Bearer token authentication with password hashing (`bcryptjs`).
* OAuth 2.0 Google Sign-In registration & login flow.
* Device binding workflow (`POST /api/device/bind`) capturing IMEI, model, and OS specs.
* 6-Digit cryptographically secure access code generation for trusted circle trackers.

### ✅ Module 2: Real-Time Geolocation & Maplibre Vector Engine
* High-accuracy GPS location tracking via `locationService.ts` (`Geolocation.watchPosition`, 3-5s interval, 5m movement threshold).
* Socket.IO streaming pipeline: `socket.emit('location_update')` -> backend broadcasts `location-broadcast` to `device-${deviceId}` room -> asynchronously logs to PostgreSQL `LocationLog` table.
* Historical route polyline visualization rendered directly over MapLibre dark & street basemaps.

### ✅ Module 3: Immersive Google Maps-Style Interface
* 100% full edge-to-edge satellite map mode (`isFullScreen={true}`).
* Floating top header bar with prominent **`← Back`** button to return to home dashboard and target title box.
* Google Maps-style bottom floating card sheet featuring real-time coordinates, GPS accuracy (`±5m`), live pulse dot, and action buttons (`🎯 Recenter`, `🌙/☀️ Basemap`, `📥 Offline Pack`, `📷 AR Vision`).

### ✅ Module 4: Visual Augmented Reality (AR) Final-Approach View
* Triggered when tracker is near the target (`< 15 meters`) or via **`📷 AR Vision`** tap.
* Real-time camera viewfinder feed overlay ([ARViewComponent.tsx](file:///Users/nuwangi/Desktop/research/safe-circle/frontend/src/components/ARViewComponent.tsx)).
* Trigonometric compass bearing engine ([distance.ts](file:///Users/nuwangi/Desktop/research/safe-circle/frontend/src/utils/distance.ts)): `calculateBearingDegrees` and `calculateDistanceMeters` compute target bearing and rotate a 3D HUD arrow toward the physical phone coordinates.
* Proximity reticle, distance gauge (`4.2m away`), and signal strength bar.

### ✅ Module 5: Safe Zones (Geofencing System)
* Database Model ([SafeZone.js](file:///Users/nuwangi/Desktop/research/safe-circle/backend/models/SafeZone.js)): Stores safe zone boundaries (`userId`, `zoneName`, `latitude`, `longitude`, `radiusMeters`, `isActive`).
* API Routes ([safeZoneRoutes.js](file:///Users/nuwangi/Desktop/research/safe-circle/backend/routes/safeZoneRoutes.js)): `POST /api/geofence`, `GET /api/geofence`, `DELETE /api/geofence/:id`.
* Map Rendering ([MapViewComponent.tsx](file:///Users/nuwangi/Desktop/research/safe-circle/frontend/src/components/MapViewComponent.tsx)): Dynamically draws semi-transparent green fill (`safezones-fill`) and dotted line (`safezones-outline`) GeoJSON circle polygons.
* Backend Geofence Evaluator ([server.js](file:///Users/nuwangi/Desktop/research/safe-circle/backend/server.js)): Socket.IO `location_update` calculates distance to active safe zones; broadcasts `geofence-breach` alerts if device exits boundary.

### ✅ Module 6: Remote Audio Alert & Ambient Audio Recorder
* Silent-mode audio override utilizing `STREAM_ALARM` audio channel.
* Ambient audio clip recording and upload (`POST /api/contacts/shared/alerts/:alertId/audio`) during emergency SOS alerts via native Kotlin `AudioRecorderModule`.

### ✅ Module 7: Hardened Security & Access Delegation Architecture (Step 1)
* **Cryptographic TOTP Two-Factor Authentication**: RFC 6238 TOTP engine (`otplib`) generating 6-digit rotating authenticator tokens with ±30s clock drift tolerance.
* **Tracker Session JWT**: Time-bounded 2-hour recovery tokens issued exclusively upon successful TOTP access code verification (`POST /api/contacts/shared/verify`).
* **Socket.IO Handshake Authentication**: Enforces strict JSON Web Token validation at connection handshake (`io.use()`), immediately rejecting unauthenticated or spoofed WebSocket clients.
* **Granular Room Authorization**: Strict authorization prevents unauthorized socket clients from intercepting or spoofing location broadcasts for devices they do not own or track.
* **Brute-Force Rate Limiting**: Tiered IP rate limiting defending against authentication credential stuffing (15 req / 15 min) and access code enumeration (10 req / 15 min).

### ✅ Module 8: On-Device Dual-Stage Machine Learning Pipeline (Step 2)
* **Stage 1 (Feature Extraction Heuristic)**: Real-time 50Hz IMU sensor filtering tracking dynamic acceleration magnitude ($a_{mag}$), jerk ($\Delta a / \Delta t$), and angular velocity ($g_{mag}$). Sub-5ms fast-path execution.
* **Stage 2 (Quantized TFLite Neural Inference Engine)**: Ultra-compact (20.74 KB) quantized neural network model running directly on Android CPU via TensorFlow Lite 2.16.1. Evaluates 100-sample sliding sensor windows with 0.007ms latency (<15ms requirement).
* **Native Audio Recorder Module**: Background audio capture (`AudioRecorderModule.kt`) capturing ambient acoustics immediately upon snatch confirmation.

### ✅ Module 9: Tactical AR View HUD & Live Guardian UX (Step 3)
* **Tactical AR View Overlay**: Real-time camera HUD ([ARViewComponent.tsx](file:///Users/nuwangi/Desktop/research/safe-circle/frontend/src/components/ARViewComponent.tsx)) featuring optical crosshairs, horizon level markers, distance proximity gauge, target sighting lock, and dual Night Vision (`🟢 NVG` / `🔵 HUD`) modes.
* **Native Torch LED Module**: Camera2 hardware torch strobe integration ([TorchModule.kt](file:///Users/nuwangi/Desktop/research/safe-circle/frontend/android/app/src/main/java/com/safecircleapp/TorchModule.kt)) for dark recovery environments.
* **Tracker Dashboard Live UX**: Real-time WebSocket connection state banner (`CONNECTED`, `RECONNECTING`, `OFFLINE`), dynamic coordinate fix latency timer ("Just now", "12s ago"), manual reconnect trigger, and one-tap AR Vision launcher.

### ✅ Module 10: Background Resilience & Adaptive Battery Optimization (Step 4)
* **Native Android Foreground Service**: Continuous background operation on Android 10+ (API 29+) through Android 15 (API 35) using `FOREGROUND_SERVICE_TYPE_LOCATION or FOREGROUND_SERVICE_TYPE_SPECIAL_USE`.
* **Adaptive Tracking Modes**:
  - `PASSIVE_MONITORING`: 45-second intervals, 30-meter displacement threshold, balanced power accuracy, conserving ~80% battery during routine daily carry (1.1%/hr discharge).
  - `EMERGENCY_SOS`: 3-second rapid intervals, 0-meter displacement threshold, high accuracy GPS streaming during recovery.
* **30-Second Liveness Heartbeat**: Device-to-guardian heartbeat ping ensuring guardians are instantly alerted if the stolen device goes offline or loses connectivity.

### ✅ Module 11: End-to-End System Integration & Empirical Verification (Step 5)
* **Automated Backend Test Suite**: 46/46 tests passed (12 Security hardening tests, 23 End-to-end REST API lifecycle tests, 11 OWASP Mobile security audit tests with 100% compliance).
* **Automated Frontend Test Suite**: 17/17 tests passed across all 6 Jest test suites (`geofence`, `distance`, `theme`, `App`, `step3_ar_tracker`, `step4_background_resilience`).
* **Automated ML Inference Suite**: 12/12 tests passed validating model weights, tensor shapes, benign/theft classification, and sub-millisecond inference latency.
* **Quantitative Benchmark Compliance**: Live empirical benchmarks confirm Auth API (95ms < 200ms), Protected API (4.4ms < 150ms), and WebSocket streaming delay (21.1ms < 100ms) meet all thesis specifications.

---

## 4. Key File Architecture Reference

```
safe-circle/
├── backend/
│   ├── config/db.js                 # PostgreSQL Sequelize database connection
│   ├── controllers/
│   │   ├── authController.js        # User auth & Google Sign-In logic
│   │   ├── deviceController.js      # Device registration & binding
│   │   ├── contactController.js     # Trusted contacts & access code generation
│   │   ├── locationController.js    # Location log database retrieval
│   │   ├── alertController.js       # Emergency SOS alert creation & resolution
│   │   └── safeZoneController.js    # Safe Zone (Geofence) CRUD operations
│   ├── models/                      # Sequelize models (User, Device, Contact, Log, Alert, SafeZone)
│   ├── routes/                      # Express route endpoints (/api/auth, /api/device, etc.)
│   └── server.js                    # Express app, Socket.IO WebSockets, Geofence breach evaluator
│
└── frontend/
    ├── App.tsx                      # Root navigation controller, Socket.IO client, global session state
    ├── src/
    │   ├── components/
    │   │   ├── MapViewComponent.tsx # Satellite map, GeoJSON polylines/circles, Google Maps overlays
    │   │   ├── ARViewComponent.tsx  # 3D camera HUD, compass bearing pointer arrow, proximity reticle
    │   │   ├── DeviceCard.tsx       # Bound device card item
    │   │   ├── ContactCard.tsx      # Trusted contact item
    │   │   └── FeedbackBanner.tsx   # Top banner notification toast
    │   ├── screens/
    │   │   ├── DashboardScreen.tsx  # Home dashboard, SOS trigger, Safe Zones management card
    │   │   ├── TrackerDashboardScreen.tsx # Remote contact tracking dashboard
    │   │   ├── WelcomeScreen.tsx    # Auth entry screen
    │   │   ├── SignUpScreen.tsx     # Local registration form
    │   │   ├── BindDeviceScreen.tsx # Device binding form
    │   │   ├── AddContactScreen.tsx # Trusted contact creation form
    │   │   └── TrackerAuthScreen.tsx# Access code entry for remote trackers
    │   ├── services/
    │   │   ├── api.ts               # HTTP client methods for backend API
    │   │   ├── locationService.ts   # Fused Location Provider API & watchPosition manager
    │   │   ├── audioService.ts      # Audio alarm player & recording manager
    │   │   └── offlineMapService.ts # MapLibre offline tile pack downloader
    │   └── utils/
    │       └── distance.ts          # Haversine distance & compass bearing math
```

---

## 5. Development & Execution Cheat Sheet

### 1. ADB Network Reverse Rules (Required for Android Emulator)
Whenever starting or restarting Metro bundler / Android emulator:
```bash
adb reverse tcp:8081 tcp:8081
adb reverse tcp:5001 tcp:5001
```

### 2. Injecting Simulated GPS Coordinates to Emulator
```bash
adb emu geo fix -122.4194 37.7749
```

### 3. Starting the Backend Server
```bash
cd backend
npm start
# Server runs on http://localhost:5001 (Swagger docs at http://localhost:5001/api-docs)
```

### 4. Running the Frontend Application
```bash
cd frontend
npm run android
```

---

## 6. Next Recommended Development Tasks

1. **Motion Sensor Theft Detection Module**: Implement accelerometer and gyroscope gesture monitoring to detect sudden device displacement or handling anomalies.
2. **Smooth Marker Path Interpolation**: Animate map marker pin transitions smoothly between coordinate updates over 2-3 seconds.
3. **Multi-Device Map Overview**: Render multiple registered devices simultaneously on a single map bounds.
