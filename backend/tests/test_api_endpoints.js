/**
 * SafeCircle Automated End-to-End API Test Suite
 * Tests all key REST endpoints on either Live or Local backend.
 *
 * Usage:
 *   node backend/tests/test_api_endpoints.js
 *   node backend/tests/test_api_endpoints.js http://localhost:5001
 */

const BASE_URL = process.argv[2] || process.env.API_BASE_URL || 'http://localhost:5001';

console.log(`\n======================================================`);
console.log(`🛡️  SafeCircle API Endpoint Verification Suite`);
console.log(`🌐 Target Server: ${BASE_URL}`);
console.log(`======================================================\n`);

let token = null;
let testUserId = null;
let testDeviceId = null;
let testContactId = null;
let testAccessCode = null;
let totpProvisioningUri = null;
let trackerSessionToken = null;
let testAlertId = null;
let testSafeZoneId = null;

const uniqueId = Date.now();
const testUser = {
  fullName: `API Tester ${uniqueId}`,
  email: `api-test-${uniqueId}@example.com`,
  phoneNumber: `+1555${Math.floor(100000 + Math.random() * 900000)}`,
  password: 'Password123!',
  confirmPassword: 'Password123!',
};

let passed = 0;
let failed = 0;

async function runStep(name, fn) {
  process.stdout.write(`⏳ Testing: ${name}... `);
  try {
    const result = await fn();
    console.log(`✅ PASS`);
    if (result) console.log(`   └─ ${result}`);
    passed++;
  } catch (err) {
    console.log(`❌ FAIL`);
    console.error(`   └─ Error: ${err.message}${err.cause ? ' (' + (err.cause.message || err.cause) + ')' : ''}`);
    failed++;
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-test-bypass': 'skip-limiter',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const res = await fetch(url, { ...options, headers });
  let json = null;
  try {
    json = await res.json();
  } catch {
    // Non-JSON response
  }

  return { status: res.status, ok: res.ok, data: json };
}

async function main() {
  // 1. Health / Swagger Docs
  await runStep('Swagger API Docs (GET /api-docs/)', async () => {
    const res = await fetch(`${BASE_URL}/api-docs/`);
    if (res.status !== 200) throw new Error(`Expected HTTP 200, got ${res.status}`);
    return `Interactive Swagger UI online (HTTP ${res.status})`;
  });

  // 2. User Registration
  await runStep('Register User (POST /api/auth/register)', async () => {
    const { status, ok, data } = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(testUser),
    });
    if (!ok || !data?.token) throw new Error(data?.message || `HTTP ${status}`);
    token = data.token;
    testUserId = data.data?.id;
    return `Registered User ID: ${testUserId} (Token received)`;
  });

  // 3. User Login
  await runStep('Login User (POST /api/auth/login)', async () => {
    const { status, ok, data } = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: testUser.email, password: testUser.password }),
    });
    if (!ok || !data?.token) throw new Error(data?.message || `HTTP ${status}`);
    token = data.token;
    return `Logged in successfully as ${testUser.email}`;
  });

  // 4. Google Sandbox Login (Development only)
  await runStep('Google SSO Dev Sandbox (POST /api/auth/google)', async () => {
    const { status, ok, data } = await request('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken: `sandbox-google-token:::sandbox-${uniqueId}@example.com:::SandboxUser` }),
    });
    if (ok && data?.token) {
      return `Dev Sandbox active: User ID ${data.data?.id}`;
    }
    if (status === 401) {
      return `Sandbox disabled in production (Security constraint verified: HTTP 401)`;
    }
    throw new Error(data?.message || `HTTP ${status}`);
  });

  // 5. Bind Device
  await runStep('Bind Device (POST /api/device/bind)', async () => {
    const { status, ok, data } = await request('/api/device/bind', {
      method: 'POST',
      body: JSON.stringify({
        deviceName: `Test Device ${uniqueId}`,
        deviceModel: 'Pixel 9 Pro API 35',
        imeiNumber: `IMEI-${uniqueId}`,
        deviceOs: 'Android 15',
      }),
    });
    if (!ok || !data?.data?.id) throw new Error(data?.message || `HTTP ${status}`);
    testDeviceId = data.data.id;
    return `Device registered with ID: ${testDeviceId}`;
  });

  // 6. Get Bound Devices
  await runStep('List Bound Devices (GET /api/device)', async () => {
    const { status, ok, data } = await request('/api/device');
    if (!ok || !Array.isArray(data?.data)) throw new Error(data?.message || `HTTP ${status}`);
    return `Found ${data.data.length} registered device(s)`;
  });

  // 7. Add Trusted Contact (Unregistered User -> Prioritizes Email Invitation)
  await runStep('Add Trusted Contact (POST /api/contacts - Priority Email Route)', async () => {
    const { status, ok, data } = await request('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({
        contactName: 'Emergency Responder Jane',
        contactPhone: '+19998887777',
        contactEmail: `jane-${uniqueId}@example.com`,
        relationship: 'Family',
      }),
    });
    if (!ok || !data?.data?.id) throw new Error(data?.message || `HTTP ${status}`);
    if (data.delivery?.deliveryChannel !== 'EMAIL_INVITATION' || data.delivery?.isRegisteredUser !== false) {
      throw new Error(`Expected EMAIL_INVITATION delivery, got: ${JSON.stringify(data.delivery)}`);
    }
    testContactId = data.data.id;
    testAccessCode = data.data.accessCode;
    totpProvisioningUri = data.totpProvisioningUri;
    return `Created Contact ID: ${testContactId} (Route: ${data.delivery.deliveryChannel}, Code: ${testAccessCode})`;
  });

  // 7b. Add Registered Trusted Contact -> Prioritizes In-App Push Notification
  await runStep('Add Registered Contact (POST /api/contacts - Priority In-App Push Route)', async () => {
    const { status, ok, data } = await request('/api/contacts', {
      method: 'POST',
      body: JSON.stringify({
        contactName: 'Self / Registered Guardian',
        contactPhone: testUser.phoneNumber,
        contactEmail: testUser.email,
        relationship: 'Partner',
      }),
    });
    if (!ok || !data?.data?.id) throw new Error(data?.message || `HTTP ${status}`);
    if (data.delivery?.deliveryChannel !== 'PUSH_NOTIFICATION' || data.delivery?.isRegisteredUser !== true) {
      throw new Error(`Expected PUSH_NOTIFICATION delivery for registered member, got: ${JSON.stringify(data.delivery)}`);
    }
    // Clean up this second contact right away so other tests maintain clean state
    await request(`/api/contacts/${data.data.id}`, { method: 'DELETE' });
    return `Verified Registered Route: ${data.delivery.deliveryChannel} (isRegisteredUser: true)`;
  });

  // 8. Update Contact Sharing Mode
  await runStep('Update Sharing Mode (PUT /api/contacts/:id/sharing-mode)', async () => {
    const { status, ok, data } = await request(`/api/contacts/${testContactId}/sharing-mode`, {
      method: 'PUT',
      body: JSON.stringify({ sharingMode: 'ALWAYS_ON' }),
    });
    if (!ok || data?.data?.sharingMode !== 'ALWAYS_ON') throw new Error(data?.message || `HTTP ${status}`);
    return `Updated sharingMode to ALWAYS_ON`;
  });

  // 9. List Contacts
  await runStep('List Trusted Contacts (GET /api/contacts)', async () => {
    const { status, ok, data } = await request('/api/contacts');
    if (!ok || !Array.isArray(data?.data)) throw new Error(data?.message || `HTTP ${status}`);
    return `Found ${data.data.length} trusted contact(s)`;
  });

  // 9b. List Guardianship Circle (People Who Added Me)
  await runStep('List Guardianship Circle (GET /api/contacts/guardianship)', async () => {
    const { status, ok, data } = await request('/api/contacts/guardianship');
    if (!ok || !Array.isArray(data?.data)) throw new Error(data?.message || `HTTP ${status}`);
    return `Guardianship query successful (${data.data.length} ward(s) found)`;
  });

  // 10. Log Geolocation
  await runStep('Log GPS Location (POST /api/location/log)', async () => {
    const { status, ok, data } = await request('/api/location/log', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: testDeviceId,
        latitude: 6.9271,
        longitude: 79.8612,
        accuracy: 4.5,
        batteryLevel: 88,
        isMoving: true,
      }),
    });
    if (!ok) throw new Error(data?.message || `HTTP ${status}`);
    return `GPS Coordinate logged: 6.9271, 79.8612`;
  });

  // 11. Create Geofence Safe Zone
  await runStep('Create Geofence Safe Zone (POST /api/geofence)', async () => {
    const { status, ok, data } = await request('/api/geofence', {
      method: 'POST',
      body: JSON.stringify({
        zoneName: 'Home Base',
        latitude: 6.9271,
        longitude: 79.8612,
        radius: 300,
        notifyOnEntry: true,
        notifyOnExit: true,
      }),
    });
    if (!ok || !data?.data?.id) throw new Error(data?.message || `HTTP ${status}`);
    testSafeZoneId = data.data.id;
    return `Safe Zone Created: "${data.data.zoneName}" (Radius: 300m)`;
  });

  // 12. List Geofence Safe Zones
  await runStep('List Safe Zones (GET /api/geofence)', async () => {
    const { status, ok, data } = await request('/api/geofence');
    if (!ok || !Array.isArray(data?.data)) throw new Error(data?.message || `HTTP ${status}`);
    return `Found ${data.data.length} safe zone(s)`;
  });

  // 13. Trigger SOS Emergency Alert
  await runStep('Trigger Emergency SOS (POST /api/alerts)', async () => {
    const { status, ok, data } = await request('/api/alerts', {
      method: 'POST',
      body: JSON.stringify({
        deviceId: testDeviceId,
        alertType: 'SOS',
        latitude: 6.9271,
        longitude: 79.8612,
        batteryLevel: 85,
      }),
    });
    if (!ok || !data?.data?.id) throw new Error(data?.message || `HTTP ${status}`);
    testAlertId = data.data.id;
    return `SOS Alert Triggered! ID: ${testAlertId}`;
  });

  // 14. Get Active Alerts
  await runStep('Get Active Alerts (GET /api/alerts/active)', async () => {
    const { status, ok, data } = await request('/api/alerts/active');
    if (!ok || !Array.isArray(data?.data)) throw new Error(data?.message || `HTTP ${status}`);
    return `Active alerts count: ${data.data.length}`;
  });

  // 15. Verify Contact Access Code + TOTP (Issues Session JWT)
  await runStep('Verify Contact Access Code + TOTP (POST /api/contacts/shared/verify)', async () => {
    const match = totpProvisioningUri?.match(/secret=([A-Z0-9]+)/i);
    const secret = match ? match[1] : null;
    if (!secret) throw new Error('Could not find TOTP secret in provisioning URI');
    const { generateToken } = require('../utils/totp');
    const totpToken = await generateToken(secret);

    const { status, ok, data } = await request('/api/contacts/shared/verify', {
      method: 'POST',
      body: JSON.stringify({ accessCode: testAccessCode, totpToken }),
    });
    if (!ok || !data?.trackerSessionToken) throw new Error(data?.message || `HTTP ${status}`);
    trackerSessionToken = data.trackerSessionToken;
    return `Access Code Verified! Session JWT issued for: ${data.data?.targetUser?.fullName}, Mode: ${data.data?.sharingMode}`;
  });

  // 16. Get Shared Tracking History (Authenticated via Tracker Session JWT)
  await runStep('Get Shared Location Stream (GET /api/contacts/shared/:code)', async () => {
    const { status, ok, data } = await request(`/api/contacts/shared/${testAccessCode}`, {
      headers: { Authorization: `Bearer ${trackerSessionToken}` },
    });
    if (!ok || !Array.isArray(data?.data)) throw new Error(data?.message || `HTTP ${status}`);
    return `Retrieved ${data.data.length} shared location breadcrumb(s) using Session JWT`;
  });

  // 16b. Security Auth Check: Reject Location Stream without Session JWT
  await runStep('Auth Check: Location Stream without Session JWT (GET /api/contacts/shared/:code)', async () => {
    const { status } = await request(`/api/contacts/shared/${testAccessCode}`, {
      headers: { Authorization: '' },
    });
    if (status !== 401) throw new Error(`Expected 401 Unauthorized, got HTTP ${status}`);
    return `Access correctly denied without Session JWT (HTTP 401)`;
  });

  // 17. Resolve Emergency Alert
  await runStep('Resolve Alert (PUT /api/alerts/:id/resolve)', async () => {
    const { status, ok, data } = await request(`/api/alerts/${testAlertId}/resolve`, {
      method: 'PUT',
    });
    if (!ok) throw new Error(data?.message || `HTTP ${status}`);
    return `Alert ${testAlertId} resolved successfully`;
  });

  // 18. Cleanup Safe Zone
  await runStep('Cleanup Safe Zone (DELETE /api/geofence/:id)', async () => {
    const { status, ok } = await request(`/api/geofence/${testSafeZoneId}`, {
      method: 'DELETE',
    });
    if (!ok) throw new Error(`HTTP ${status}`);
    return `Safe zone deleted cleanly`;
  });

  // 19. Cleanup Trusted Contact
  await runStep('Cleanup Contact (DELETE /api/contacts/:id)', async () => {
    const { status, ok } = await request(`/api/contacts/${testContactId}`, {
      method: 'DELETE',
    });
    if (!ok) throw new Error(`HTTP ${status}`);
    return `Contact deleted cleanly`;
  });

  // 20. Cleanup Bound Device
  await runStep('Cleanup Device (DELETE /api/device/:id)', async () => {
    const { status, ok } = await request(`/api/device/${testDeviceId}`, {
      method: 'DELETE',
    });
    if (!ok) throw new Error(`HTTP ${status}`);
    return `Device unbind complete`;
  });

  console.log(`\n------------------------------------------------------`);
  console.log(`📊 Test Results: ${passed} Passed, ${failed} Failed out of ${passed + failed} Tests`);
  console.log(`------------------------------------------------------\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal Test Suite Error:', err);
  process.exit(1);
});
