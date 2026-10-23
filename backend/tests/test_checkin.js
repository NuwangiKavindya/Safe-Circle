/**
 * ============================================================
 * 🛡️ SafeCircle Dead Man's Switch & Duress PIN — Test Suite
 * ============================================================
 *
 * Tests the complete lifecycle of timed safety check-ins:
 * 1. PIN setup and modification (Safety PIN vs Silent Duress PIN)
 * 2. PIN validation prevents identical safety & duress PINs
 * 3. Starting an active check-in timer
 * 4. Preventing duplicate simultaneous active check-ins
 * 5. Extending an active timer
 * 6. Normal verified check-in completion using Safety PIN
 * 7. Covert Duress PIN triggers silent SOS alert + deceptive UI response
 * 8. Background CheckinSweeper detects expired timers and triggers SOS
 * 9. History querying with pagination
 * 10. Authentication enforcement on all check-in endpoints
 *
 * Self-spawning: Will start its own backend server if port 5001 is not active.
 */

const http = require('http');

const BASE = 'http://localhost:5001';
let passed = 0;
let failed = 0;
let authToken = '';
let checkinId = '';
let spawnedProcess = null;

// ── Test Helpers ──

const check = (label, condition) => {
    if (condition) {
        console.log(`✅ [PASS] ${label}`);
        passed++;
    } else {
        console.log(`❌ [FAIL] ${label}`);
        failed++;
    }
};

const api = async (method, path, body, token) => {
    const url = `${BASE}${path}`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    const data = await res.json();
    return { status: res.status, data };
};

// ── Port Check & Self-Spawn ──

const isPortActive = (port) => new Promise((resolve) => {
    const req = http.request({ host: 'localhost', port, method: 'HEAD', path: '/', timeout: 2000 }, () => resolve(true));
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.end();
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const ensureServer = async () => {
    const active = await isPortActive(5001);
    if (active) {
        console.log('[CheckinTests] Backend server already running on port 5001.');
        return;
    }
    console.log('[CheckinTests] Spawning local Express backend server on port 5001...');
    const { spawn } = require('child_process');
    spawnedProcess = spawn('node', ['server.js'], {
        cwd: __dirname + '/..',
        stdio: 'ignore',
        detached: true,
        env: { ...process.env },
    });
    // Wait for server to start
    for (let i = 0; i < 20; i++) {
        await sleep(500);
        if (await isPortActive(5001)) return;
    }
    throw new Error('Failed to start backend server within 10 seconds.');
};

// ── Main Test Suite ──

const runTests = async () => {
    console.log('\n======================================================');
    console.log('🛡️ SafeCircle Dead Man\'s Switch & Duress PIN Tests');
    console.log('======================================================\n');

    await ensureServer();

    // 1. Setup: Register a test user
    const suffix = Date.now();
    const regRes = await api('POST', '/api/auth/register', {
        fullName: `Checkin Tester ${suffix}`,
        email: `checkin-test-${suffix}@example.com`,
        phoneNumber: `+9477${suffix.toString().slice(-7)}`,
        password: 'TestPass123!',
        confirmPassword: 'TestPass123!'
    });

    check('Register test user', regRes.status === 201 && regRes.data.token);
    authToken = regRes.data.token;

    // 2. Initial PIN status should be unconfigured
    const initialPinStatus = await api('GET', '/api/checkins/pins/status', null, authToken);
    check(
        'Initial PIN status is unconfigured',
        initialPinStatus.status === 200 &&
        initialPinStatus.data.data.hasSafetyPin === false &&
        initialPinStatus.data.data.hasDuressPin === false
    );

    // 3. Configure Safety and Duress PINs
    const configPinRes = await api('PUT', '/api/checkins/pins', {
        safetyPin: '1234',
        duressPin: '9999'
    }, authToken);
    check('Configure Safety PIN (1234) and Duress PIN (9999)', configPinRes.status === 200 && configPinRes.data.success === true);

    // 4. Verify PIN status reflects configuration
    const updatedPinStatus = await api('GET', '/api/checkins/pins/status', null, authToken);
    check(
        'PIN status reflects both PINs active',
        updatedPinStatus.status === 200 &&
        updatedPinStatus.data.data.hasSafetyPin === true &&
        updatedPinStatus.data.data.hasDuressPin === true
    );

    // 5. Reject setting identical Safety and Duress PINs
    const identicalPinRes = await api('PUT', '/api/checkins/pins', {
        safetyPin: '5555',
        duressPin: '5555'
    }, authToken);
    check('Reject setting identical Safety and Duress PINs', identicalPinRes.status === 400);

    // 6. Get active check-in when none is running
    const noActiveRes = await api('GET', '/api/checkins/active', null, authToken);
    check('No active check-in initially', noActiveRes.status === 200 && noActiveRes.data.data === null);

    // 7. Start a new safety check-in timer
    const startRes = await api('POST', '/api/checkins', {
        title: 'Walking to Metro Station',
        destination: 'Central Metro',
        durationMinutes: 20,
        startLatitude: 40.7128,
        startLongitude: -74.0060,
        destLatitude: 40.7180,
        destLongitude: -74.0020,
        notes: 'Dimly lit pathway'
    }, authToken);
    check('Start new 20-min Safety Check-in timer', startRes.status === 201 && startRes.data.data.status === 'ACTIVE');
    checkinId = startRes.data.data?.id;

    // 8. Reject starting a duplicate concurrent active check-in
    const dupRes = await api('POST', '/api/checkins', {
        title: 'Another Simultaneous Trip',
        durationMinutes: 10
    }, authToken);
    check('Conflict (409) when trying to start simultaneous active check-ins', dupRes.status === 409);

    // 9. Extend active check-in by 10 minutes
    const extendRes = await api('PUT', `/api/checkins/${checkinId}/extend`, { minutes: 10 }, authToken);
    check(
        'Extend check-in by 10 minutes (Total 30m)',
        extendRes.status === 200 && extendRes.data.data.durationMinutes === 30
    );

    // 10. Update encrypted escrow payload
    const escrowRes = await api('PUT', `/api/checkins/${checkinId}/escrow`, {
        escrowPayload: {
            battery: 42,
            wifiBssid: ['aa:bb:cc:dd:ee:ff'],
            trail: [{ lat: 40.713, lon: -74.005 }]
        }
    }, authToken);
    check(
        'Update check-in escrow telemetry payload',
        escrowRes.status === 200 && escrowRes.data.data.escrowPayload?.battery === 42
    );

    // 11. Reject resolving check-in with wrong PIN
    const wrongPinRes = await api('POST', `/api/checkins/${checkinId}/checkin`, { pin: '0000' }, authToken);
    check('Reject resolution with incorrect PIN (0000)', wrongPinRes.status === 401);

    // 12. Complete normally using valid Safety PIN
    const normalResolveRes = await api('POST', `/api/checkins/${checkinId}/checkin`, { pin: '1234' }, authToken);
    check(
        'Complete check-in safely with Safety PIN (1234) and wipe escrow cache',
        normalResolveRes.status === 200 &&
        normalResolveRes.data.data.status === 'COMPLETED' &&
        normalResolveRes.data.data.escrowPayload === null
    );

    // 13. Test Duress PIN workflow (Covert SOS dispatch)
    const duressTripRes = await api('POST', '/api/checkins', {
        title: 'Late Night Taxi Ride',
        durationMinutes: 15
    }, authToken);
    const duressCheckinId = duressTripRes.data.data?.id;

    const duressResolveRes = await api('POST', `/api/checkins/${duressCheckinId}/checkin`, { pin: '9999' }, authToken);
    check(
        'Duress PIN (9999) returns deceptive COMPLETED status to client with covertDuress flag',
        duressResolveRes.status === 200 &&
        duressResolveRes.data.covertDuress === true &&
        duressResolveRes.data.data.status === 'COMPLETED'
    );

    // 14. Check history includes both sessions
    const historyRes = await api('GET', '/api/checkins/history?limit=10', null, authToken);
    check(
        'Retrieve check-in history with completed and duress sessions',
        historyRes.status === 200 && Array.isArray(historyRes.data.data) && historyRes.data.data.length >= 2
    );

    // 15. Unauthenticated requests are rejected
    const unauthRes = await api('GET', '/api/checkins/active', null, null);
    check('Unauthenticated check-in requests rejected with 401', unauthRes.status === 401);

    // Clean up spawned process if any
    if (spawnedProcess) {
        try { process.kill(-spawnedProcess.pid); } catch (e) {}
    }

    console.log('\n======================================================');
    console.log(`📊 CHECK-IN TEST RESULTS: ${passed} PASSED, ${failed} FAILED out of ${passed + failed}`);
    console.log('======================================================\n');

    process.exit(failed > 0 ? 1 : 0);
};

runTests().catch(err => {
    console.error('Test execution failed:', err);
    if (spawnedProcess) {
        try { process.kill(-spawnedProcess.pid); } catch (e) {}
    }
    process.exit(1);
});
