const SafetyCheckin = require('../models/SafetyCheckin');
const User = require('../models/User');
const Alert = require('../models/Alert');
const TrustedContact = require('../models/TrustedContact');
const { dispatchSosNotifications } = require('../utils/notifications');
const checkinSweeper = require('../services/checkinSweeper');

/**
 * @desc    Configure or update safety and duress PINs
 * @route   PUT /api/checkins/pins
 * @access  Private
 */
exports.configurePins = async (req, res) => {
    try {
        const { safetyPin, duressPin } = req.body;

        if (!safetyPin && !duressPin) {
            return res.status(400).json({
                success: false,
                message: 'Please provide either safetyPin or duressPin to update.'
            });
        }

        if (safetyPin && duressPin && safetyPin === duressPin) {
            return res.status(400).json({
                success: false,
                message: 'Duress PIN must be different from your regular Safety PIN.'
            });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        if (safetyPin) user.safetyPin = String(safetyPin);
        if (duressPin) user.duressPin = String(duressPin);

        await user.save();

        return res.status(200).json({
            success: true,
            message: 'Safety PINs updated successfully.',
            data: {
                hasSafetyPin: !!user.safetyPin,
                hasDuressPin: !!user.duressPin
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get PIN status (whether pins are configured, never exposes the actual hashes)
 * @route   GET /api/checkins/pins/status
 * @access  Private
 */
exports.getPinStatus = async (req, res) => {
    try {
        const user = await User.findByPk(req.user.id, {
            attributes: ['id', 'safetyPin', 'duressPin']
        });
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        return res.status(200).json({
            success: true,
            data: {
                hasSafetyPin: !!user.safetyPin,
                hasDuressPin: !!user.duressPin
            }
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Start a new Dead Man's Switch / Safety Check-in timer
 * @route   POST /api/checkins
 * @access  Private
 */
exports.startCheckin = async (req, res) => {
    try {
        const {
            title,
            destination,
            destLatitude,
            destLongitude,
            startLatitude,
            startLongitude,
            durationMinutes = 15,
            notes,
            escrowPayload
        } = req.body;

        const duration = parseInt(durationMinutes, 10);
        if (isNaN(duration) || duration < 1 || duration > 1440) {
            return res.status(400).json({
                success: false,
                message: 'durationMinutes must be an integer between 1 and 1440.'
            });
        }

        // Check if there is already an active check-in for this user
        const existing = await SafetyCheckin.findOne({
            where: { userId: req.user.id, status: 'ACTIVE' }
        });

        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'An active safety check-in is already in progress. Complete or extend it before starting a new one.',
                data: existing
            });
        }

        const expiresAt = new Date(Date.now() + duration * 60 * 1000);

        const checkin = await SafetyCheckin.create({
            userId: req.user.id,
            title: title || 'Safety Escort',
            destination: destination || null,
            destLatitude: destLatitude || null,
            destLongitude: destLongitude || null,
            startLatitude: startLatitude || null,
            startLongitude: startLongitude || null,
            durationMinutes: duration,
            expiresAt,
            status: 'ACTIVE',
            notes: notes || null,
            escrowPayload: escrowPayload || null
        });

        return res.status(201).json({
            success: true,
            data: checkin
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get currently active check-in for the user
 * @route   GET /api/checkins/active
 * @access  Private
 */
exports.getActiveCheckin = async (req, res) => {
    try {
        // Run sweeper first so if it expired, the user gets current accurate state
        await checkinSweeper.sweepExpiredCheckins();

        const activeCheckin = await SafetyCheckin.findOne({
            where: { userId: req.user.id, status: 'ACTIVE' }
        });

        return res.status(200).json({
            success: true,
            data: activeCheckin || null
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Extend an active check-in timer
 * @route   PUT /api/checkins/:id/extend
 * @access  Private
 */
exports.extendCheckin = async (req, res) => {
    try {
        const { minutes = 15 } = req.body;
        const addMinutes = parseInt(minutes, 10);

        if (isNaN(addMinutes) || addMinutes < 1 || addMinutes > 360) {
            return res.status(400).json({
                success: false,
                message: 'Extension minutes must be between 1 and 360.'
            });
        }

        const checkin = await SafetyCheckin.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });

        if (!checkin) {
            return res.status(404).json({ success: false, message: 'Check-in not found.' });
        }

        if (checkin.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                message: `Cannot extend check-in with status "${checkin.status}".`
            });
        }

        const currentExpiry = new Date(checkin.expiresAt).getTime();
        const baseTime = currentExpiry > Date.now() ? currentExpiry : Date.now();
        checkin.expiresAt = new Date(baseTime + addMinutes * 60 * 1000);
        checkin.durationMinutes += addMinutes;
        await checkin.save();

        return res.status(200).json({
            success: true,
            message: `Check-in extended by ${addMinutes} minutes.`,
            data: checkin
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Update the encrypted escrow payload (e.g. ambient snapshots or telemetry trail)
 * @route   PUT /api/checkins/:id/escrow
 * @access  Private
 */
exports.updateEscrowPayload = async (req, res) => {
    try {
        const { escrowPayload } = req.body;

        const checkin = await SafetyCheckin.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });

        if (!checkin) {
            return res.status(404).json({ success: false, message: 'Check-in not found.' });
        }

        if (checkin.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                message: 'Cannot update escrow on inactive check-in.'
            });
        }

        checkin.escrowPayload = escrowPayload;
        await checkin.save();

        return res.status(200).json({
            success: true,
            data: checkin
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Check-in / Cancel using PIN (supports Normal Safety PIN or Silent Duress PIN)
 * @route   POST /api/checkins/:id/checkin
 * @access  Private
 */
exports.verifyAndResolveCheckin = async (req, res) => {
    try {
        const { pin, latitude, longitude } = req.body;

        const checkin = await SafetyCheckin.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });

        if (!checkin) {
            return res.status(404).json({ success: false, message: 'Check-in not found.' });
        }

        if (checkin.status !== 'ACTIVE') {
            return res.status(400).json({
                success: false,
                message: `Check-in is already in ${checkin.status} state.`
            });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found.' });
        }

        // If user configured a safety PIN or duress PIN, PIN verification is enforced
        if (user.safetyPin || user.duressPin) {
            if (!pin) {
                return res.status(400).json({
                    success: false,
                    message: 'Safety PIN is required to complete this check-in.'
                });
            }

            const { valid, isDuress } = await user.verifyPin(String(pin));
            if (!valid) {
                return res.status(401).json({
                    success: false,
                    message: 'Incorrect PIN.'
                });
            }

            // DURESS COERCION DETECTION!
            if (isDuress) {
                // Silently mark checkin as DURESS_TRIGGERED
                checkin.status = 'DURESS_TRIGGERED';
                checkin.duressTriggered = true;
                checkin.completedAt = new Date();

                // Covertly fire high-priority SOS alert
                const alert = await Alert.create({
                    userId: user.id,
                    alertType: 'COVERT_DURESS_PIN',
                    status: 'ACTIVE',
                    latitude: latitude || checkin.destLatitude || checkin.startLatitude || null,
                    longitude: longitude || checkin.destLongitude || checkin.startLongitude || null
                });

                checkin.alertId = alert.id;
                await checkin.save();

                // Dispatch silent SOS alert to trusted circle
                const contacts = await TrustedContact.findAll({
                    where: { userId: user.id }
                });

                dispatchSosNotifications(user, contacts, alert).catch(err => {
                    console.error('[CheckinController] Duress SOS notification error:', err.message);
                });

                // Return a deceptive SUCCESS response to the client
                // This ensures an attacker looking over the user's shoulder believes the alarm was safely disarmed!
                return res.status(200).json({
                    success: true,
                    message: 'Check-in confirmed. Safe arrival recorded.',
                    covertDuress: true,
                    data: {
                        id: checkin.id,
                        status: 'COMPLETED' // Deceptive status for UI display to attacker
                    }
                });
            }
        }

        // Normal verified check-in completion
        checkin.status = 'COMPLETED';
        checkin.completedAt = new Date();
        // Clear escrow data upon safe verification to preserve user privacy
        checkin.escrowPayload = null;
        await checkin.save();

        return res.status(200).json({
            success: true,
            message: 'Safety check-in verified successfully. Glad you are safe!',
            data: checkin
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get check-in history
 * @route   GET /api/checkins/history
 * @access  Private
 */
exports.getCheckinHistory = async (req, res) => {
    try {
        const { limit = 20, page = 1 } = req.query;
        const offset = (page - 1) * limit;

        const checkins = await SafetyCheckin.findAndCountAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']],
            limit: parseInt(limit, 10),
            offset: parseInt(offset, 10)
        });

        return res.status(200).json({
            success: true,
            data: checkins.rows,
            total: checkins.count,
            page: parseInt(page, 10)
        });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
};
