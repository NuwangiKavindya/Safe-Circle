const LocationLog = require('../models/LocationLog');
const Device = require('../models/Device');

/**
 * @desc    Log device geolocation coordinates
 * @route   POST /api/location/log
 * @access  Private
 */
exports.logLocation = async (req, res) => {
    try {
        const { deviceId, latitude, longitude, accuracy } = req.body;

        if (!deviceId || latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Please provide deviceId, latitude, and longitude.'
            });
        }

        // Verify the device belongs to the logged-in user
        const device = await Device.findOne({
            where: { id: deviceId, userId: req.user.id }
        });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device not found or not authorized'
            });
        }

        // Create the location log
        const log = await LocationLog.create({
            deviceId,
            latitude,
            longitude,
            accuracy
        });

        // Broadcast location via WebSocket to any connected tracking web clients
        const io = req.app.get('io');
        if (io) {
            const payload = {
                deviceId,
                latitude,
                longitude,
                accuracy,
                timestamp: log.timestamp || new Date()
            };
            io.to(`device-${deviceId}`).emit('location-broadcast', payload);
            if (req.user && req.user.id) {
                io.to(`tracker-${req.user.id}`).emit('location-broadcast', payload);
            }
        }

        res.status(201).json({
            success: true,
            data: log
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Get location logs history for a device
 * @route   GET /api/location/history/:deviceId
 * @access  Private
 */
exports.getLocationHistory = async (req, res) => {
    try {
        const { deviceId } = req.params;

        // Verify the device belongs to the logged-in user
        const device = await Device.findOne({
            where: { id: deviceId, userId: req.user.id }
        });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device not found or not authorized'
            });
        }

        // Get logs
        const logs = await LocationLog.findAll({
            where: { deviceId },
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
