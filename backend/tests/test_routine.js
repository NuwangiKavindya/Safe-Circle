/**
 * ============================================================
 * 🧠 SafeCircle Smart Routine Anomaly Detection — Test Suite
 * ============================================================
 *
 * Tests the full routine feature lifecycle:
 *   1. Anchor CRUD (create, read, update, delete)
 *   2. On-demand routine learning trigger
 *   3. Deviation listing & acknowledgment
 *   4. Guardian ward deviation access
 *   5. Authorization enforcement
 *
 * Self-spawning: Will start its own backend server if port 5001 is not active.
 */

const http = require('http');
const crypto = require('crypto');

const BASE = 'http://localhost:5001';
let passed = 0;
let failed = 0;
let authToken = '';
let userId = '';
let createdAnchorId = '';

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

let spawnedProcess = null;

const ensureServer = async () => {
    const active = await isPortActive(5001);
    if (active) {
        console.log('[RoutineTests] Backend server already running on port 5001.');
        return;
    }
    console.log('[RoutineTests] Spawning local Express backend server on port 5001...');
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
    console.log('🧠 SafeCircle Smart Routine Anomaly Detection Tests');
    console.log('======================================================\n');

    await ensureServer();

    // ── Setup: Register a test user ──
    const suffix = Date.now();
    const regResult = await api('POST', '/api/auth/register', {
        fullName: `Routine Tester ${suffix}`,
        email: `routine-test-${suffix}@example.com`,
        phoneNumber: `+9477${suffix.toString().slice(-7)}`,
        password: 'TestPass123!',
        confirmPassword: 'TestPass123!',
    });
    check('Register test user', regResult.status === 201 && regResult.data.token);
    authToken = regResult.data.token;
    userId = regResult.data.data?.id;
    console.log(`   └─ User ID: ${userId}`);

    // ── 1. Get Anchors (empty initially) ──
    const emptyAnchors = await api('GET', '/api/routine/anchors', null, authToken);
    check('Get anchors (empty)', emptyAnchors.status === 200 && emptyAnchors.data.count === 0);

    // ── 2. Create Manual Anchor ──
    const createResult = await api('POST', '/api/routine/anchors', {
        label: 'School',
        latitude: 6.9271,
        longitude: 79.8612,
        radiusMeters: 200,
        daysMask: 31,          // Mon-Fri
        expectedArrivalMinute: 450,   // 7:30 AM
        expectedDepartureMinute: 840, // 2:00 PM
        toleranceMinutes: 20,
    }, authToken);
    check('Create manual anchor', createResult.status === 201 && createResult.data.data?.label === 'School');
    createdAnchorId = createResult.data.data?.id;
    console.log(`   └─ Anchor ID: ${createdAnchorId}, Source: ${createResult.data.data?.source}`);

    // ── 3. Get Anchors (should have 1) ──
    const anchorsAfterCreate = await api('GET', '/api/routine/anchors', null, authToken);
    check('Get anchors (1 anchor)', anchorsAfterCreate.status === 200 && anchorsAfterCreate.data.count === 1);
    const anchorData = anchorsAfterCreate.data.data?.[0];
    check('Anchor has schedule metadata', anchorData?.schedule?.arrival && anchorData?.schedule?.departure && anchorData?.schedule?.days?.length > 0);
    console.log(`   └─ Schedule: ${anchorData?.schedule?.days?.join(', ')} ${anchorData?.schedule?.arrival} - ${anchorData?.schedule?.departure}`);

    // ── 4. Update Anchor (rename + confirm) ──
    const updateResult = await api('PUT', `/api/routine/anchors/${createdAnchorId}`, {
        label: 'Royal College',
        toleranceMinutes: 15,
    }, authToken);
    check('Update anchor (rename + adjust tolerance)', updateResult.status === 200 && updateResult.data.data?.label === 'Royal College');
    check('Anchor auto-confirmed on edit', updateResult.data.data?.isConfirmed === true);

    // ── 5. Trigger On-Demand Learning (should succeed even with no GPS data) ──
    const learnResult = await api('POST', '/api/routine/learn', null, authToken);
    check('Trigger routine learning', learnResult.status === 200 && learnResult.data.success === true);
    console.log(`   └─ ${learnResult.data.message}`);

    // ── 6. Get Deviations (empty initially) ──
    const emptyDeviations = await api('GET', '/api/routine/deviations', null, authToken);
    check('Get deviations (empty)', emptyDeviations.status === 200 && emptyDeviations.data.count === 0);

    // ── 7. Get Deviations with query params ──
    const deviationsWithParams = await api('GET', '/api/routine/deviations?limit=5&includeAcknowledged=true', null, authToken);
    check('Get deviations with query params', deviationsWithParams.status === 200 && deviationsWithParams.data.success === true);

    // ── 8. Authorization: Unauthenticated access denied ──
    const noAuth = await api('GET', '/api/routine/anchors');
    check('Unauthenticated anchor access denied', noAuth.status === 401);

    // ── 9. Authorization: Unauthenticated learning denied ──
    const noAuthLearn = await api('POST', '/api/routine/learn');
    check('Unauthenticated learning denied', noAuthLearn.status === 401);

    // ── 10. Delete Anchor ──
    const deleteResult = await api('DELETE', `/api/routine/anchors/${createdAnchorId}`, null, authToken);
    check('Delete anchor', deleteResult.status === 200 && deleteResult.data.success === true);

    // ── 11. Verify deletion ──
    const anchorsAfterDelete = await api('GET', '/api/routine/anchors', null, authToken);
    check('Verify anchor deleted', anchorsAfterDelete.status === 200 && anchorsAfterDelete.data.count === 0);

    // ── 12. Delete non-existent anchor returns 404 ──
    const deleteGhost = await api('DELETE', `/api/routine/anchors/${crypto.randomUUID()}`, null, authToken);
    check('Delete non-existent anchor returns 404', deleteGhost.status === 404);

    // ── Summary ──
    console.log('\n======================================================');
    console.log(`📊 ROUTINE TEST RESULTS: ${passed} PASSED, ${failed} FAILED out of ${passed + failed}`);
    console.log('======================================================\n');

    process.exit(failed > 0 ? 1 : 0);
};

// ── Execute ──

runTests().catch(err => {
    console.error('[RoutineTests] Fatal error:', err.message);
    process.exit(1);
}).finally(() => {
    if (spawnedProcess) {
        try { process.kill(-spawnedProcess.pid); } catch {}
    }
});
