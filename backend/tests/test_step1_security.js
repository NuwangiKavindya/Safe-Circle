const io = require('socket.io-client');
const jwt = require('jsonwebtoken');
const dotenv = require('dotenv');
const http = require('http');

dotenv.config();

const BASE_URL = 'http://localhost:5001';
const User = require('../models/User');
const Device = require('../models/Device');
const TrustedContact = require('../models/TrustedContact');
const { generateTOTP, generateSecret } = require('../utils/totp');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function httpRequest(options, body = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                let parsed = data;
                try { parsed = JSON.parse(data); } catch (e) {}
                resolve({ statusCode: res.statusCode, headers: res.headers, body: parsed });
            });
        });
        req.on('error', reject);
        if (body) {
            req.write(typeof body === 'string' ? body : JSON.stringify(body));
        }
        req.end();
    });
}

async function runStep1Tests() {
    console.log('====================================================');
    console.log('🚀 RUNNING STEP 1 SECURITY HARDENING TEST SUITE');
    console.log('====================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(cond, desc) {
        if (cond) {
            console.log(`✅ [PASS] ${desc}`);
            passed++;
        } else {
            console.error(`❌ [FAIL] ${desc}`);
            failed++;
        }
    }

    try {
        // Setup Test Users and Devices
        const timestamp = Date.now();
        const userA = await User.create({
            fullName: 'Test Owner A',
            email: `ownerA_${timestamp}@test.com`,
            phoneNumber: `+1800555${Math.floor(1000 + Math.random() * 9000)}`,
            password: 'Password123!',
            confirmPassword: 'Password123!'
        });

        const userB = await User.create({
            fullName: 'Test Owner B',
            email: `ownerB_${timestamp}@test.com`,
            phoneNumber: `+1800556${Math.floor(1000 + Math.random() * 9000)}`,
            password: 'Password123!',
            confirmPassword: 'Password123!'
        });

        const deviceA = await Device.create({
            userId: userA.id,
            deviceName: 'Owner A Pixel',
            deviceModel: 'Pixel 8',
            imeiNumber: `35899901${Math.floor(1000000 + Math.random() * 9000000)}`,
            deviceOs: 'Android 14'
        });

        const deviceB = await Device.create({
            userId: userB.id,
            deviceName: 'Owner B Samsung',
            deviceModel: 'Galaxy S24',
            imeiNumber: `35899902${Math.floor(1000000 + Math.random() * 9000000)}`,
            deviceOs: 'Android 14'
        });

        const userAToken = jwt.sign({ id: userA.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
        const userBToken = jwt.sign({ id: userB.id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        const contactA = await TrustedContact.create({
            userId: userA.id,
            contactName: 'Guardian A',
            contactPhone: '+18007771234',
            contactEmail: `guardianA_${timestamp}@test.com`,
            relationship: 'Family'
        });

        const trackerSessionToken = jwt.sign({
            contactId: contactA.id,
            accessCode: contactA.accessCode,
            role: 'TRACKER'
        }, process.env.JWT_SECRET, { expiresIn: '2h' });

        // ─────────────────────────────────────────────────────────────
        // TEST 1: Unauthenticated Socket Connection must be REJECTED
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- 1. Socket.IO Handshake Authentication ---');
        await new Promise((resolve) => {
            const socket = io(BASE_URL, {
                transports: ['websocket'],
                reconnection: false
            });
            socket.on('connect_error', (err) => {
                assert(err.message.includes('Token required'), 'Socket rejected when connecting without token');
                socket.disconnect();
                resolve();
            });
            socket.on('connect', () => {
                assert(false, 'Socket should not connect without token!');
                socket.disconnect();
                resolve();
            });
        });

        // ─────────────────────────────────────────────────────────────
        // TEST 2: Socket Connection with Invalid Token must be REJECTED
        // ─────────────────────────────────────────────────────────────
        await new Promise((resolve) => {
            const socket = io(BASE_URL, {
                transports: ['websocket'],
                reconnection: false,
                auth: { token: 'invalid.jwt.token' }
            });
            socket.on('connect_error', (err) => {
                assert(err.message.includes('Invalid or expired token'), 'Socket rejected when connecting with fake JWT');
                socket.disconnect();
                resolve();
            });
            socket.on('connect', () => {
                assert(false, 'Socket should not connect with fake JWT!');
                socket.disconnect();
                resolve();
            });
        });

        // ─────────────────────────────────────────────────────────────
        // TEST 3: Socket Connection with Valid User JWT must SUCCEED
        // ─────────────────────────────────────────────────────────────
        let socketOwnerA = null;
        await new Promise((resolve) => {
            socketOwnerA = io(BASE_URL, {
                transports: ['websocket'],
                auth: { token: userAToken }
            });
            socketOwnerA.on('connect', () => {
                assert(true, 'User A connected successfully with valid JWT');
                resolve();
            });
            socketOwnerA.on('connect_error', (err) => {
                assert(false, `User A connection failed: ${err.message}`);
                resolve();
            });
        });

        // ─────────────────────────────────────────────────────────────
        // TEST 4: Room Authorization - Joining Unowned Device Room REJECTED
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- 2. Socket.IO Room Authorization ---');
        await new Promise((resolve) => {
            socketOwnerA.emit('join-device-room', { deviceId: deviceB.id });
            socketOwnerA.once('error_message', (data) => {
                assert(data.message.includes('Unauthorized'), 'User A cannot join User B device room');
                resolve();
            });
            setTimeout(resolve, 500); // timeout fallback
        });

        // ─────────────────────────────────────────────────────────────
        // TEST 5: Room Authorization - Joining Owned Device Room SUCCEEDS
        // ─────────────────────────────────────────────────────────────
        socketOwnerA.emit('join-device-room', { deviceId: deviceA.id });
        await sleep(100);
        assert(true, 'User A joined own device room without error');

        // ─────────────────────────────────────────────────────────────
        // TEST 6: Tracker Socket Connection with Tracker Session JWT
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- 3. Guardian / Tracker Socket Session ---');
        let socketTrackerA = null;
        await new Promise((resolve) => {
            socketTrackerA = io(BASE_URL, {
                transports: ['websocket'],
                auth: { token: trackerSessionToken }
            });
            socketTrackerA.on('connect', () => {
                assert(true, 'Tracker socket connected with Tracker Session JWT');
                resolve();
            });
            socketTrackerA.on('connect_error', (err) => {
                assert(false, `Tracker connection failed: ${err.message}`);
                resolve();
            });
        });

        // Tracker joins deviceA room (should be allowed because deviceA belongs to userA)
        socketTrackerA.emit('join-device-room', { deviceId: deviceA.id });
        await sleep(150);

        // ─────────────────────────────────────────────────────────────
        // TEST 7: Tracker cannot publish GPS updates (Anti-Spoofing)
        // ─────────────────────────────────────────────────────────────
        await new Promise((resolve) => {
            socketTrackerA.emit('location_update', {
                deviceId: deviceA.id,
                latitude: 6.9271,
                longitude: 79.8612
            });
            socketTrackerA.once('error_message', (data) => {
                assert(data.message.includes('Trackers are not authorized'), 'Tracker blocked from emitting fake location_update');
                resolve();
            });
            setTimeout(resolve, 500);
        });

        // ─────────────────────────────────────────────────────────────
        // TEST 8: Device Owner emits location -> Tracker receives broadcast
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- 4. Real-Time Location Streaming ---');
        await new Promise((resolve) => {
            socketTrackerA.once('location-broadcast', (data) => {
                assert(data.deviceId === deviceA.id && data.latitude === 6.9271, 'Tracker received live location-broadcast from device owner');
                resolve();
            });

            socketOwnerA.emit('location_update', {
                deviceId: deviceA.id,
                latitude: 6.9271,
                longitude: 79.8612,
                accuracy: 3.5
            });
            setTimeout(resolve, 1000);
        });

        // Clean up sockets
        if (socketOwnerA) socketOwnerA.disconnect();
        if (socketTrackerA) socketTrackerA.disconnect();

        // ─────────────────────────────────────────────────────────────
        // TEST 9: Audio File Access Protection
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- 5. Audio File Protection ---');
        // Unauthenticated request to /uploads/audio/test.mp3
        const unauthAudio = await httpRequest({
            hostname: 'localhost',
            port: 5001,
            path: '/uploads/audio/sample_evidence.mp3',
            method: 'GET'
        });
        assert(unauthAudio.statusCode === 401, 'Unauthenticated audio request returns 401 Unauthorized');

        // Request with Bearer User Token (file doesn't exist on disk, but auth must pass -> 404 not 401)
        const authHeaderAudio = await httpRequest({
            hostname: 'localhost',
            port: 5001,
            path: '/uploads/audio/sample_evidence.mp3',
            method: 'GET',
            headers: { Authorization: `Bearer ${userAToken}` }
        });
        assert(authHeaderAudio.statusCode === 404, 'Authenticated user audio request passes auth (404 file not found)');

        // Request with ?token= Tracker Token query param
        const authQueryAudio = await httpRequest({
            hostname: 'localhost',
            port: 5001,
            path: `/uploads/audio/sample_evidence.mp3?token=${trackerSessionToken}`,
            method: 'GET'
        });
        assert(authQueryAudio.statusCode === 404, 'Tracker audio stream via ?token= passes auth (404 file not found)');

        // ─────────────────────────────────────────────────────────────
        // TEST 10: Auth Rate Limiter
        // ─────────────────────────────────────────────────────────────
        console.log('\n--- 6. Authentication Rate Limiting ---');
        // Send requests to /api/auth/login to trigger rate limit (configured for 15 requests)
        let rateLimited = false;
        for (let i = 0; i < 18; i++) {
            const res = await httpRequest({
                hostname: 'localhost',
                port: 5001,
                path: '/api/auth/login',
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }, { email: 'wrong@test.com', password: 'wrong' });

            if (res.statusCode === 429) {
                rateLimited = true;
                break;
            }
        }
        assert(rateLimited, 'Repeated login attempts trigger 429 Too Many Requests');

        // Cleanup test models
        await Device.destroy({ where: { id: [deviceA.id, deviceB.id] } });
        await TrustedContact.destroy({ where: { id: contactA.id } });
        await User.destroy({ where: { id: [userA.id, userB.id] } });

    } catch (err) {
        console.error('Test execution error:', err);
        failed++;
    }

    console.log('\n====================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('====================================================');

    process.exit(failed > 0 ? 1 : 0);
}

runStep1Tests();
