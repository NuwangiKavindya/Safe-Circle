const TrustedContact = require('../models/TrustedContact');
const User = require('../models/User');
const Alert = require('../models/Alert');
const Device = require('../models/Device');
const LocationLog = require('../models/LocationLog');
const { verifyToken } = require('../utils/totp');
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

        // Exactly 6 digits required
        if (!/^\d{6}$/.test(totpToken)) {
            return res.status(400).json({
                success: false,
                message: 'totpToken must be exactly 6 digits.'
            });
        }

        // 1. Look up the contact relationship by the stable, non-secret handle
        const contact = await TrustedContact.findOne({
            where: { accessCode },
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

        // 2. RFC 6238 TOTP validation
        //    otplib checks the token against the current 30-second window
        //    and window ±1 (i.e. ±30 seconds) to handle clock drift.
        const isValidToken = await verifyToken(totpToken, contact.totpSecret);

        if (!isValidToken) {
            return res.status(401).json(AUTH_FAILURE);
        }

        // 3. Mark contact as verified on first successful TOTP validation
        if (!contact.isVerified) {
            contact.isVerified = true;
            await contact.save();
        }

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
                    id: contact.user.id,
                    fullName: contact.user.fullName,
                    phoneNumber: contact.user.phoneNumber
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

        res.status(200).json({
            success: true,
            data: {
                contactName: contact.contactName,
                relationship: contact.relationship,
                sharingMode: contact.sharingMode || 'EMERGENCY_ONLY',
                targetUser: {
                    id: contact.user.id,
                    fullName: contact.user.fullName,
                    phoneNumber: contact.user.phoneNumber
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

        if (accessCode && contact.accessCode !== accessCode) {
            return res.status(403).json({
                success: false,
                message: 'Access forbidden: Access code does not match authenticated tracker session.'
            });
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

