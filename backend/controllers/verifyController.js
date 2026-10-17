const { Op } = require('sequelize');
const TrustedContact = require('../models/TrustedContact');
const User = require('../models/User');
const Alert = require('../models/Alert');
const Device = require('../models/Device');
const LocationLog = require('../models/LocationLog');
const { verifyToken } = require('../utils/totp');
const { isTokenConsumed, markTokenConsumed } = require('../utils/totpReplayCache');
const { sendRemoteSirenPushNotification } = require('../services/pushService');
const jwt = require('jsonwebtoken');

/**
 * @desc    Validate contact access code handle + RFC 6238 TOTP token and issue Tracker Session JWT
 * @route   POST /api/contacts/shared/verify
 * @access  Public (rate-limited to 10 req / 15 min in server.js)
 *
 * Request body:
 *   { accessCode: "SC-A3F2B1C9", totpToken: "382917" }
 *
 * accessCode  — stable handle shared once in the invitation message.
 *               Identifies WHICH contact relationship to look up.
 * totpToken   — rotating 6-digit code from the contact's authenticator app
 *               (Google Authenticator, Authy, etc.). Valid for 30 seconds,
 *               server accepts ±1 window to tolerate clock drift.
 *
 * Response includes:
 *   trackerSessionToken — 2-hour signed JWT for authenticating subsequent
 *                         location telemetry and polling requests without
 *                         needing to re-enter rotating TOTP tokens.
 */
exports.verifyAccessCode = async (req, res) => {
    try {
        const { accessCode, totpToken } = req.body;

        if (!accessCode || !totpToken) {
            return res.status(400).json({
                success: false,
                message: 'Both accessCode (contact handle) and totpToken (6-digit authenticator code) are required.'
            });
        }

        const cleanAccessCode = String(accessCode).trim().toUpperCase();
        const cleanTotpToken = String(totpToken).trim();

        // Exactly 6 digits required
        if (!/^\d{6}$/.test(cleanTotpToken)) {
            return res.status(400).json({
                success: false,
                message: 'totpToken must be exactly 6 digits.'
            });
        }

        // 1. Look up the contact relationship by the stable, non-secret handle (e.g. "SC-A3F2B1C9")
        const contact = await TrustedContact.findOne({
            where: {
                [Op.or]: [
                    { accessCode: cleanAccessCode },
                    { accessCode: String(accessCode).trim() }
                ]
            },
            include: [{ model: User, as: 'user' }]
        });

        // Return the same generic error for both "handle not found" and "TOTP wrong"
        // to prevent oracle attacks (attacker learning which handles are valid).
        const AUTH_FAILURE = {
            success: false,
            message: 'Access denied. Invalid access code or authentication token.'
        };

        if (!contact || !contact.totpSecret) {
            return res.status(401).json(AUTH_FAILURE);
        }

        // 2. Anti-Replay Check (RFC 6238 Section 5.2):
        //    Ensure a 6-digit TOTP token cannot be replayed within its 90s validity window.
        const isReplayed = isTokenConsumed(contact.id, cleanTotpToken) ||
            (contact.lastUsedTotpToken === cleanTotpToken &&
             contact.lastTotpUsedAt &&
             (Date.now() - new Date(contact.lastTotpUsedAt).getTime()) < 120000);

        if (isReplayed) {
            console.warn(`[Security Alert] 🚨 Blocked replay attack for contact ${contact.id} using token ${cleanTotpToken}`);
            return res.status(401).json({
                success: false,
                message: 'This authentication code has already been used. Please wait for the code to rotate in your authenticator app.'
            });
        }

        // 3. RFC 6238 TOTP validation
        //    otplib checks the token against the current 30-second window
        //    and window ±1 (i.e. ±30 seconds) to handle clock drift.
        const isValidToken = await verifyToken(cleanTotpToken, contact.totpSecret);

        if (!isValidToken) {
            return res.status(401).json(AUTH_FAILURE);
        }

        // Mark token as consumed in in-memory TTL replay cache and database
        markTokenConsumed(contact.id, cleanTotpToken);
        contact.lastUsedTotpToken = cleanTotpToken;
        contact.lastTotpUsedAt = new Date();

        // 4. Mark contact as verified on first successful TOTP validation
        if (!contact.isVerified) {
            contact.isVerified = true;
        }
        await contact.save();

        // 4. Query active alerts for the associated user
        const activeAlert = await Alert.findOne({
            where: { userId: contact.userId, status: 'ACTIVE' }
        });

        // 5. Resolve deviceId
        let deviceId = activeAlert ? activeAlert.deviceId : null;
        if (!deviceId) {
            const userDevice = await Device.findOne({
                where: { userId: contact.userId },
                order: [['updatedAt', 'DESC']]
            });
            if (userDevice) deviceId = userDevice.id;
        }

        // 6. Issue time-bounded Tracker Session JWT (valid for 2 hours during recovery)
        const trackerSessionToken = jwt.sign(
            {
                contactId: contact.id,
                userId: contact.userId,
                accessCode: contact.accessCode,
                role: 'TRACKER'
            },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.status(200).json({
            success: true,
            trackerSessionToken,
            data: {
                contactName: contact.contactName,
                relationship: contact.relationship,
                sharingMode: contact.sharingMode || 'EMERGENCY_ONLY',
                targetUser: {
                    id: contact.user ? contact.user.id : contact.userId,
                    fullName: contact.user ? contact.user.fullName : contact.contactName,
                    phoneNumber: contact.user ? contact.user.phoneNumber : ''
                },
                isActiveSos: !!activeAlert,
                alertId: activeAlert ? activeAlert.id : null,
                deviceId: deviceId,
                audioFileUrl: activeAlert ? activeAlert.audioFileUrl : null
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get current session status and active alert state for authenticated tracker
 * @route   GET /api/contacts/shared/status
 * @access  Private (Secured by Tracker Session JWT)
 */
exports.getTrackerSessionStatus = async (req, res) => {
    try {
        const contact = req.trackerContact;

        const activeAlert = await Alert.findOne({
            where: { userId: contact.userId, status: 'ACTIVE' }
        });

        let deviceId = activeAlert ? activeAlert.deviceId : null;
        if (!deviceId) {
            const userDevice = await Device.findOne({
                where: { userId: contact.userId },
                order: [['updatedAt', 'DESC']]
            });
            if (userDevice) deviceId = userDevice.id;
        }

        global.activeSirenState = global.activeSirenState || new Map();
        const isRemoteSirenActive = !!global.activeSirenState.get(contact.userId);

        res.status(200).json({
            success: true,
            data: {
                contactName: contact.contactName,
                relationship: contact.relationship,
                sharingMode: contact.sharingMode || 'EMERGENCY_ONLY',
                targetUser: {
                    id: contact.user ? contact.user.id : contact.userId,
                    fullName: contact.user ? contact.user.fullName : contact.contactName,
                    phoneNumber: contact.user ? contact.user.phoneNumber : ''
                },
                isActiveSos: !!activeAlert,
                alertId: activeAlert ? activeAlert.id : null,
                deviceId: deviceId,
                audioFileUrl: activeAlert ? activeAlert.audioFileUrl : null,
                isRemoteSirenActive: isRemoteSirenActive
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get real-time location logs for shared contact access code
 * @route   GET /api/contacts/shared/location/:accessCode
 * @route   GET /api/contacts/shared/:accessCode
 * @route   GET /api/contacts/shared/shared/:accessCode (Legacy compatibility)
 * @access  Private (Secured by Tracker Session JWT)
 */
exports.getSharedLocationHistory = async (req, res) => {
    try {
        const { accessCode } = req.params;

        // 1. Authenticate relationship via verified tracker session
        const contact = req.trackerContact;

        if (accessCode) {
            const cleanParamCode = accessCode.trim().toUpperCase();
            const contactCode = (contact.accessCode || '').trim().toUpperCase();
            if (contactCode !== cleanParamCode && contact.accessCode !== accessCode) {
                return res.status(403).json({
                    success: false,
                    message: 'Access forbidden: Access code does not match authenticated tracker session.'
                });
            }
        }

        // 2. Validate emergency status or ALWAYS_ON mode
        const activeAlert = await Alert.findOne({
            where: {
                userId: contact.userId,
                status: 'ACTIVE'
            }
        });

        const isAlwaysOn = contact.sharingMode === 'ALWAYS_ON';

        if (!activeAlert && !isAlwaysOn) {
            return res.status(403).json({
                success: false,
                message: 'Access forbidden. Geolocation logs are visible only during active emergency SOS events (or when Always-On Circle sharing is enabled).'
            });
        }

        // 3. Find user's devices
        const devices = await Device.findAll({
            where: { userId: contact.userId }
        });

        if (devices.length === 0) {
            if (activeAlert && activeAlert.latitude && activeAlert.longitude) {
                return res.status(200).json({
                    success: true,
                    count: 1,
                    data: [{
                        id: activeAlert.id,
                        deviceId: activeAlert.deviceId,
                        latitude: parseFloat(activeAlert.latitude),
                        longitude: parseFloat(activeAlert.longitude),
                        accuracy: 10.0,
                        timestamp: activeAlert.createdAt
                    }]
                });
            }
            return res.status(200).json({
                success: true,
                count: 0,
                data: [],
                message: 'No registered tracking devices found for the user.'
            });
        }

        const deviceIds = devices.map(d => d.id);

        // 4. Retrieve location logs history
        const logs = await LocationLog.findAll({
            where: {
                deviceId: deviceIds
            },
            order: [['timestamp', 'DESC']],
            limit: 50
        });

        if (logs.length === 0 && activeAlert && activeAlert.latitude && activeAlert.longitude) {
            return res.status(200).json({
                success: true,
                count: 1,
                data: [{
                    id: activeAlert.id,
                    deviceId: activeAlert.deviceId,
                    latitude: parseFloat(activeAlert.latitude),
                    longitude: parseFloat(activeAlert.longitude),
                    accuracy: 10.0,
                    timestamp: activeAlert.createdAt
                }]
            });
        }

        res.status(200).json({
            success: true,
            count: logs.length,
            data: logs
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Remotely trigger or silence the physical audible alarm on ward's device
 * @route   POST /api/contacts/shared/remote-siren
 * @access  Private (Device Owner or Authorized Tracker via protectAny)
 */
exports.triggerRemoteSiren = async (req, res) => {
    try {
        const { deviceId, action, targetUserId: explicitTargetUserId } = req.body || {};
        const sirenAction = action === 'STOP' ? 'STOP' : 'START';

        // Identify the target ward's userId
        let targetUserId = req.isTracker ? req.trackerContact.userId : req.user.id;
        let triggeredByRole = req.isTracker ? 'GUARDIAN' : 'OWNER';

        if (!req.isTracker && explicitTargetUserId && explicitTargetUserId !== req.user.id) {
            // Check if req.user is an authorized trusted guardian for explicitTargetUserId
            const contact = await TrustedContact.findOne({
                where: {
                    userId: explicitTargetUserId,
                    [Op.or]: [
                        { contactEmail: req.user.email },
                        { contactPhone: req.user.phoneNumber }
                    ]
                }
            });
            if (contact) {
                targetUserId = explicitTargetUserId;
                triggeredByRole = 'GUARDIAN';
            }
        }

        // Resolve device
        let targetDeviceId = deviceId;
        let device = null;
        if (targetDeviceId) {
            device = await Device.findByPk(targetDeviceId);
        }
        if (!device && targetUserId) {
            device = await Device.findOne({
                where: { userId: targetUserId },
                order: [['updatedAt', 'DESC']]
            });
            if (device) targetDeviceId = device.id;
        }

        if (device && device.userId !== targetUserId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: You do not have access to trigger alarm on this device.'
            });
        }

        global.activeSirenState = global.activeSirenState || new Map();
        global.activeSirenState.set(targetUserId, sirenAction === 'START');

        const io = req.app.get('io');
        const payload = {
            deviceId: targetDeviceId,
            userId: targetUserId,
            action: sirenAction,
            triggeredBy: triggeredByRole,
            timestamp: new Date().toISOString()
        };

        if (io) {
            if (targetDeviceId) {
                io.to(`device-${targetDeviceId}`).emit('remote_siren_command', payload);
            }
            if (targetUserId) {
                io.to(`user-${targetUserId}`).emit('remote_siren_command', payload);
                io.to(`tracker-${targetUserId}`).emit('remote_siren_command', payload);
            }
            console.log(`[Remote Siren REST] 🔊 Siren ${sirenAction} broadcast for ward ${targetUserId} (device: ${targetDeviceId}) by ${triggeredByRole}`);
        }

        // Issue 3.1: Also dispatch High-Priority FCM Push Notification
        // Ensures the siren fires/stops even when the Android device is in deep Doze mode or backgrounded.
        try {
            const fcmTokens = new Set();
            if (targetUserId) {
                const targetUser = await User.findByPk(targetUserId, {
                    include: [{ model: Device, as: 'devices' }]
                });
                if (targetUser?.fcmToken) fcmTokens.add(targetUser.fcmToken);
                if (targetUser?.devices) {
                    targetUser.devices.forEach(d => {
                        if (d.fcmToken) fcmTokens.add(d.fcmToken);
                    });
                }
            }
            if (targetDeviceId && fcmTokens.size === 0) {
                const targetDev = await Device.findByPk(targetDeviceId);
                if (targetDev?.fcmToken) fcmTokens.add(targetDev.fcmToken);
            }
            const tokenList = Array.from(fcmTokens).filter(Boolean);
            if (tokenList.length > 0) {
                await sendRemoteSirenPushNotification(tokenList, {
                    deviceId: targetDeviceId,
                    targetUserId,
                    action: sirenAction,
                    triggeredBy: triggeredByRole
                });
            } else {
                console.log(`[Remote Siren REST] ℹ️ No registered FCM device tokens for user ${targetUserId}. WebSocket delivered.`);
            }
        } catch (pushErr) {
            console.warn('[Remote Siren REST] FCM push dispatch warning:', pushErr.message);
        }

        res.status(200).json({
            success: true,
            action: sirenAction,
            deviceId: targetDeviceId,
            message: `Remote siren ${sirenAction === 'START' ? 'activated' : 'deactivated'} successfully.`
        });
    } catch (error) {
        console.error('[Remote Siren REST] Error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
};

