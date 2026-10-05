const Alert = require('../models/Alert');
const Device = require('../models/Device');
const TrustedContact = require('../models/TrustedContact');
const { dispatchSosNotifications } = require('../utils/notifications');

/**
 * @desc    Trigger a new SOS alert
 * @route   POST /api/alerts
 * @access  Private
 */
exports.triggerAlert = async (req, res) => {
    try {
        const { deviceId, alertType, latitude, longitude } = req.body;

        if (!alertType) {
            return res.status(400).json({
                success: false,
                message: 'Please provide alertType (e.g. SOS).'
            });
        }

        // Verify device if provided
        if (deviceId) {
            const device = await Device.findOne({
                where: { id: deviceId, userId: req.user.id }
            });
            if (!device) {
                return res.status(404).json({
                    success: false,
                    message: 'Device not found or not authorized'
                });
            }
        }

        // Create the alert
        const alert = await Alert.create({
            userId: req.user.id,
            deviceId: deviceId || null,
            alertType,
            status: 'ACTIVE',
            latitude,
            longitude
        });

        // Fetch safety contacts circle and dispatch alerts
        const contacts = await TrustedContact.findAll({
            where: { userId: req.user.id }
        });

        dispatchSosNotifications(req.user, contacts, alert).catch(err => {
            console.error('Failed to dispatch SOS alerts: ', err.message);
        });

        res.status(201).json({
            success: true,
            data: alert
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Resolve an active alert
 * @route   PUT /api/alerts/:id/resolve
 * @access  Private
 */
exports.resolveAlert = async (req, res) => {
    try {
        const alert = await Alert.findOne({
            where: {
                id: req.params.id,
                userId: req.user.id,
                status: 'ACTIVE'
            }
        });

        if (!alert) {
            return res.status(404).json({
                success: false,
                message: 'Active alert not found or not authorized'
            });
        }

        alert.status = 'RESOLVED';
        alert.resolvedAt = new Date();
        await alert.save();

        res.status(200).json({
            success: true,
            data: alert
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Get user's active alerts
 * @route   GET /api/alerts/active
 * @access  Private
 */
exports.getActiveAlerts = async (req, res) => {
    try {
        const alerts = await Alert.findAll({
            where: {
                userId: req.user.id,
                status: 'ACTIVE'
            },
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            success: true,
            count: alerts.length,
            data: alerts
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Upload ambient audio recording to alert
 * @route   POST /api/alerts/:id/audio
 * @access  Private
 */
exports.uploadAmbientAudio = async (req, res) => {
    try {
        const alert = await Alert.findOne({
            where: { id: req.params.id, userId: req.user.id }
        });

        if (!alert) {
            return res.status(404).json({
                success: false,
                message: 'Alert not found or unauthorized'
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Please upload an audio file.'
            });
        }

        // Store file path reference
        const fileUrl = `/uploads/audio/${req.file.filename}`;
        alert.audioFileUrl = fileUrl;
        await alert.save();

        // Broadcast real-time audio update to connected guardians and trackers
        const io = req.app.get('io');
        if (io) {
            const audioPayload = {
                alertId: alert.id,
                audioFileUrl: fileUrl,
                timestamp: new Date().toISOString()
            };
            io.to(`tracker-${req.user.id}`).emit('ambient_audio_update', audioPayload);
            io.to(`user-${req.user.id}`).emit('ambient_audio_update', audioPayload);
            if (alert.deviceId) {
                io.to(`device-${alert.deviceId}`).emit('ambient_audio_update', audioPayload);
            }
            console.log(`[Audio Upload] 🎙️ Ambient audio update broadcast for user ${req.user.id}: ${fileUrl}`);
        }

        res.status(200).json({
            success: true,
            message: 'Audio recording uploaded successfully.',
            data: alert
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
