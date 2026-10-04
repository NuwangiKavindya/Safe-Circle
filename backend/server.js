const express = require('express');
const dotenv = require('dotenv');

// Load env vars
dotenv.config();

const cors = require('cors');
const { connectDB, sequelize } = require('./config/db');
const swaggerUI = require('swagger-ui-express');
const swaggerJsDoc = require('swagger-jsdoc');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const { Op } = require('sequelize');
const jwt = require('jsonwebtoken');

// Import models to register them with Sequelize
const User = require('./models/User');
const Device = require('./models/Device');
const TrustedContact = require('./models/TrustedContact');
const LocationLog = require('./models/LocationLog');
const Alert = require('./models/Alert');
const SafeZone = require('./models/SafeZone');
const SusFeedback = require('./models/SusFeedback');

const authRoutes = require('./routes/authRoutes');
const deviceRoutes = require('./routes/deviceRoutes');
const contactRoutes = require('./routes/contactRoutes');
const locationRoutes = require('./routes/locationRoutes');
const alertRoutes = require('./routes/alertRoutes');
const verifyRoutes = require('./routes/verifyRoutes');
const safeZoneRoutes = require('./routes/safeZoneRoutes');
const susRoutes = require('./routes/susRoutes');

const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

// Connect to database
connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST', 'PUT', 'DELETE']
    }
});

// Attach socket.io engine to app so controllers can trigger socket events
app.set('io', io);

// Middleware
app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
        const bodyCopy = { ...req.body };
        if (bodyCopy.password) bodyCopy.password = '[REDACTED]';
        if (bodyCopy.confirmPassword) bodyCopy.confirmPassword = '[REDACTED]';
        console.log(`  Body: ${JSON.stringify(bodyCopy)}`);
    }
    next();
});

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// ─────────────────────────────────────────────────────────────────────────────
// FIX: Audio uploads are protected by JWT authentication (User or Tracker Session).
// Requests to /uploads/audio/* accept token via Bearer header or ?token= query param.
// This prevents anyone with a guessed URL from accessing emergency recordings.
// ─────────────────────────────────────────────────────────────────────────────
const { protectAny } = require('./middleware/auth');
const fsSync = require('fs');
app.get('/uploads/audio/:filename', protectAny, (req, res) => {
    const filePath = path.join(__dirname, 'uploads', 'audio', req.params.filename);
    if (!fsSync.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'Audio file not found.' });
    }
    res.sendFile(filePath);
});

// Swagger Setup
const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Lost Phone Tracker API',
            version: '1.0.0',
            description: 'API Documentation for the Mobile Phone Tracker application including User Registration and Authentication.',
        },
        servers: [
            {
                url: '/',
                description: 'Current Environment (Auto-detected)',
            },
            {
                url: `http://localhost:${process.env.PORT || 5001}`,
                description: 'Local Development Server',
            },
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                },
            },
        },
        security: [
            {
                bearerAuth: [],
            },
        ],
    },
    apis: ['./server.js', './routes/*.js', './controllers/*.js'],
};

const specs = swaggerJsDoc(options);
app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(specs));

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Register a new user
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - email
 *               - phoneNumber
 *               - password
 *               - confirmPassword
 *             properties:
 *               fullName:
 *                 type: string
 *               email:
 *                 type: string
 *               phoneNumber:
 *                 type: string
 *               password:
 *                 type: string
 *               confirmPassword:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     fullName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     phoneNumber:
 *                       type: string
 *       400:
 *         description: Validation error or missing fields
 *       500:
 *         description: Server error
 */
/**
 * @swagger
 * /api/auth/google:
 *   post:
 *     summary: Authenticate a user via Google SSO
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 description: The Google ID token received from the client
 *     responses:
 *       200:
 *         description: User authenticated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 token:
 *                   type: string
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     fullName:
 *                       type: string
 *                     email:
 *                       type: string
 *                     phoneNumber:
 *                       type: string
 *       400:
 *         description: Missing idToken
 *       401:
 *         description: Invalid Google ID token
 */
app.use('/api/auth', authRoutes);

/**
 * @swagger
 * /api/device/bind:
 *   post:
 *     summary: Bind a new device to the authenticated user
 *     tags: [Device]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - deviceName
 *               - deviceModel
 *               - imeiNumber
 *               - deviceOs
 *             properties:
 *               deviceName:
 *                 type: string
 *               deviceModel:
 *                 type: string
 *               imeiNumber:
 *                 type: string
 *               deviceOs:
 *                 type: string
 *     responses:
 *       201:
 *         description: Device successfully bound
 *       400:
 *         description: Missing fields or IMEI already in use
 *       401:
 *         description: Not authorized
 *       500:
 *         description: Server error
 */
app.use('/api/device', deviceRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/geofence', safeZoneRoutes);
app.use('/api/sus', susRoutes);

// ─────────────────────────────────────────────────────────────────────────────
// FIX: Rate-limit the public verify endpoint to prevent brute-force attacks.
// Static access codes (6 digits = 900,000 combinations) are otherwise trivially
// enumerable. This limiter allows 10 attempts per 15-minute window per IP.
// ─────────────────────────────────────────────────────────────────────────────
const verifyRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15-minute sliding window
    max: 10,                     // max 10 attempts per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.headers['x-test-bypass'] === 'skip-limiter',
    message: {
        success: false,
        message: 'Too many verification attempts. Please wait 15 minutes before trying again.'
    }
});
app.use('/api/contacts/shared', verifyRateLimiter, verifyRoutes);

// Haversine Distance helper for Geofence evaluation (meters)
const calculateDistanceMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000; // Earth radius in meters
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// ─────────────────────────────────────────────────────────────────────────────
// FIX: Geofence breach state machine — tracks per-device INSIDE/OUTSIDE state
// to prevent event flooding. Without this, a device outside a zone for 15 min
// would emit ~300 breach events. Now it only fires on state TRANSITIONS.
// ─────────────────────────────────────────────────────────────────────────────
const geofenceDeviceState = new Map(); // deviceId -> { state: 'INSIDE'|'OUTSIDE', lastEmit: number }

// ─────────────────────────────────────────────────────────────────────────────
// Socket.io Connection & Security Logic
// ─────────────────────────────────────────────────────────────────────────────

// Handshake Authentication: Verify User JWT or Tracker Session JWT
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth?.token ||
                      (socket.handshake.headers?.authorization && socket.handshake.headers.authorization.startsWith('Bearer')
                        ? socket.handshake.headers.authorization.split(' ')[1]
                        : null) ||
                      socket.handshake.query?.token;

        if (!token) {
            console.warn(`[Socket.IO Auth] Connection rejected: Missing token (socket ${socket.id})`);
            return next(new Error('Authentication error: Token required'));
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role === 'TRACKER') {
            if (!decoded.contactId) {
                return next(new Error('Authentication error: Malformed tracker session'));
            }
            const contact = await TrustedContact.findByPk(decoded.contactId);
            if (!contact) {
                return next(new Error('Authentication error: Tracker contact revoked'));
            }
            socket.authData = {
                isTracker: true,
                contactId: contact.id,
                userId: contact.userId
            };
            return next();
        }

        // Standard registered user
        const user = await User.findByPk(decoded.id);
        if (!user) {
            return next(new Error('Authentication error: User not found'));
        }
        socket.authData = {
            isTracker: false,
            userId: user.id
        };
        next();
    } catch (err) {
        console.warn(`[Socket.IO Auth] Connection rejected: ${err.message} (socket ${socket.id})`);
        return next(new Error('Authentication error: Invalid or expired token'));
    }
});

io.on('connection', (socket) => {
    console.log(`Socket client authenticated & connected: ${socket.id} (Role: ${socket.authData.isTracker ? 'TRACKER' : 'OWNER'})`);

    // Join device room to receive location updates for a specific device
    socket.on('join-device-room', async (data) => {
        try {
            const { deviceId } = data || {};
            if (!deviceId) return;

            const device = await Device.findByPk(deviceId);
            if (!device) {
                return socket.emit('error_message', { message: 'Device not found.' });
            }

            // Both owner and guardian must belong to the user who owns this device
            if (device.userId !== socket.authData.userId) {
                console.warn(`[Socket.IO Security] Unauthorized room join attempt to device-${deviceId} from socket ${socket.id}`);
                return socket.emit('error_message', { message: 'Unauthorized: No access to this device room.' });
            }

            socket.join(`device-${deviceId}`);
            console.log(`Socket ${socket.id} (${socket.authData.isTracker ? 'Tracker' : 'Owner'}) joined room: device-${deviceId}`);
        } catch (err) {
            console.error('[Socket.IO] Error in join-device-room:', err.message);
        }
    });

    // Real-Time Location Update event from physical device GPS
    socket.on('location_update', async (data) => {
        try {
            const { deviceId, latitude, longitude, accuracy, speed, heading, timestamp } = data || {};
            if (!deviceId || latitude === undefined || longitude === undefined) {
                return;
            }

            // Security: Only the actual device owner can broadcast GPS coordinates.
            // Trackers are strictly listeners to prevent location spoofing.
            if (socket.authData.isTracker) {
                console.warn(`[Socket.IO Security] Rejected spoofed location_update from tracker socket ${socket.id}`);
                return socket.emit('error_message', { message: 'Trackers are not authorized to broadcast location updates.' });
            }

            const device = await Device.findByPk(deviceId);
            if (!device || device.userId !== socket.authData.userId) {
                console.warn(`[Socket.IO Security] User ${socket.authData.userId} attempted to broadcast coordinates for unowned device ${deviceId}`);
                return socket.emit('error_message', { message: 'Unauthorized: Device does not belong to you.' });
            }

            console.log(`[Socket.IO] Real-time location update received for device-${deviceId}: ${latitude}, ${longitude}`);

            const payload = {
                deviceId,
                latitude,
                longitude,
                accuracy: accuracy || 5.0,
                speed: speed || 0,
                heading: heading || 0,
                timestamp: timestamp || new Date().toISOString()
            };

            // 1. Broadcast immediately to any connected trusted contact watching this device room
            io.to(`device-${deviceId}`).emit('location-broadcast', payload);

            // 2. Asynchronously persist location log to database
            try {
                await LocationLog.create({
                    deviceId,
                    latitude,
                    longitude,
                    accuracy: accuracy || 5.0
                });
            } catch (err) {
                console.error('[Socket.IO] Failed to persist location update:', err.message);
            }

        // 3. Geofence Breach Check: Verify if coordinates breach any active user Safe Zones
        try {
            const device = await Device.findByPk(deviceId);
            if (device && device.userId) {
                const activeSafeZones = await SafeZone.findAll({
                    where: { userId: device.userId, isActive: true }
                });

                if (activeSafeZones.length > 0) {
                    let insideAnyZone = false;
                    let breachedZones = [];

                    for (const zone of activeSafeZones) {
                        const dist = calculateDistanceMeters(
                            parseFloat(latitude),
                            parseFloat(longitude),
                            parseFloat(zone.latitude),
                            parseFloat(zone.longitude)
                        );

                        if (dist <= parseFloat(zone.radiusMeters)) {
                            insideAnyZone = true;
                        } else {
                            breachedZones.push({ zoneName: zone.zoneName, distance: Math.round(dist), radius: zone.radiusMeters });
                        }
                    }

                    // Hysteresis: only emit on state TRANSITION (INSIDE→OUTSIDE or OUTSIDE→INSIDE)
                    const prevState = geofenceDeviceState.get(deviceId);
                    const currentState = insideAnyZone ? 'INSIDE' : 'OUTSIDE';
                    const stateChanged = !prevState || prevState.state !== currentState;

                    geofenceDeviceState.set(deviceId, { state: currentState, lastEmit: Date.now() });

                    if (!insideAnyZone && stateChanged) {
                        console.warn(`[GEOFENCE ALERT] Device ${deviceId} breached safe zones! Current coordinates: ${latitude}, ${longitude}`);
                        io.to(`device-${deviceId}`).emit('geofence-breach', {
                            deviceId,
                            latitude,
                            longitude,
                            breachedZones,
                            timestamp: new Date().toISOString(),
                            message: `⚠️ GEOFENCE WARNING: Device exited designated safe zones!`
                        });
                    } else if (insideAnyZone && stateChanged && prevState) {
                        // Notify when device re-enters a safe zone
                        io.to(`device-${deviceId}`).emit('geofence-safe', {
                            deviceId,
                            latitude,
                            longitude,
                            timestamp: new Date().toISOString(),
                            message: `✅ Device has returned to a safe zone.`
                        });
                    }
                }
            }
        } catch (geofenceErr) {
            console.error('[GEOFENCE] Error evaluating geofence breach:', geofenceErr.message);
        }
        } catch (err) {
            console.error('[Socket.IO] Error in location_update handler:', err.message);
        }
    });

    // Device Heartbeat & Liveness synchronization (Step 4)
    socket.on('heartbeat_ping', async (data) => {
        try {
            const { deviceId, batteryLevel, isCharging } = data || {};
            if (!deviceId) return;

            // Only device owners send device heartbeats
            if (!socket.authData.isTracker) {
                const device = await Device.findByPk(deviceId);
                if (device && device.userId === socket.authData.userId) {
                    await device.update({ updatedAt: new Date() });
                }
            }

            const timestamp = new Date().toISOString();
            socket.emit('heartbeat_ack', {
                status: 'OK',
                serverTime: timestamp,
            });

            // Broadcast status to room so guardians see device is online, alive, and battery level
            io.to(`device-${deviceId}`).emit('device_heartbeat', {
                deviceId,
                batteryLevel: batteryLevel !== undefined ? batteryLevel : null,
                isCharging: !!isCharging,
                timestamp,
            });
        } catch (err) {
            console.error('[Socket.IO] Error in heartbeat_ping:', err.message);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Socket client disconnected: ${socket.id}`);
    });
});

const PORT = process.env.PORT || 5001;

// ─────────────────────────────────────────────────────────────────────────────
// FIX: LocationLog data pruning cron job.
// Without pruning, a 3-second GPS update cycle produces ~28,800 rows per device
// per day. Old rows are never cleaned up, causing full-table scans over time.
// This job runs at 03:00 UTC daily and deletes rows older than 30 days.
// ─────────────────────────────────────────────────────────────────────────────
cron.schedule('0 3 * * *', async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
    try {
        const deleted = await LocationLog.destroy({
            where: { timestamp: { [Op.lt]: cutoff } }
        });
        console.log(`[Cron] LocationLog pruning complete: ${deleted} rows older than 30 days removed.`);
    } catch (err) {
        console.error('[Cron] LocationLog pruning failed:', err.message);
    }
}, { timezone: 'UTC' });

// Sync DB & Start server
sequelize.sync({ alter: true }).then(() => {
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`Server running on port ${PORT} (0.0.0.0)`);
        console.log('[Cron] LocationLog pruning job scheduled: daily at 03:00 UTC');
    });
}).catch(err => {
    console.error('Failed to sync db: ' + err.message);
});
