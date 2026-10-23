const RoutineAnchor = require('../models/RoutineAnchor');
const RoutineDeviation = require('../models/RoutineDeviation');
const { learnRoutineAnchors, formatMinutes, bitmaskIncludesDay } = require('../services/routineEngine');

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * @desc    Get all routine anchors for logged-in user
 * @route   GET /api/routine/anchors
 * @access  Private
 */
exports.getAnchors = async (req, res) => {
    try {
        const anchors = await RoutineAnchor.findAll({
            where: { userId: req.user.id, isActive: true },
            order: [['expectedArrivalMinute', 'ASC']],
        });

        // Enrich with human-readable schedule
        const enriched = anchors.map(a => {
            const days = [];
            for (let d = 0; d < 7; d++) {
                if (bitmaskIncludesDay(a.daysMask, d)) days.push(DAY_NAMES[d]);
            }
            return {
                ...a.toJSON(),
                schedule: {
                    days,
                    arrival: formatMinutes(a.expectedArrivalMinute),
                    departure: formatMinutes(a.expectedDepartureMinute),
                },
            };
        });

        res.status(200).json({
            success: true,
            count: enriched.length,
            data: enriched,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Create a manual routine anchor
 * @route   POST /api/routine/anchors
 * @access  Private
 */
exports.createAnchor = async (req, res) => {
    try {
        const { label, latitude, longitude, radiusMeters, daysMask, expectedArrivalMinute, expectedDepartureMinute, toleranceMinutes } = req.body;

        if (!label || latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Please provide label, latitude, and longitude.',
            });
        }

        const anchor = await RoutineAnchor.create({
            userId: req.user.id,
            label: label.trim(),
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            radiusMeters: radiusMeters ? parseFloat(radiusMeters) : 150.0,
            daysMask: daysMask !== undefined ? parseInt(daysMask) : 31,
            expectedArrivalMinute: expectedArrivalMinute !== undefined ? parseInt(expectedArrivalMinute) : 480,
            expectedDepartureMinute: expectedDepartureMinute !== undefined ? parseInt(expectedDepartureMinute) : 900,
            toleranceMinutes: toleranceMinutes !== undefined ? parseInt(toleranceMinutes) : 30,
            source: 'MANUAL',
            isConfirmed: true,
            isActive: true,
        });

        res.status(201).json({
            success: true,
            data: anchor,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Update a routine anchor (confirm, rename, adjust times)
 * @route   PUT /api/routine/anchors/:id
 * @access  Private
 */
exports.updateAnchor = async (req, res) => {
    try {
        const anchor = await RoutineAnchor.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });

        if (!anchor) {
            return res.status(404).json({
                success: false,
                message: 'Routine anchor not found or not authorized.',
            });
        }

        const allowedFields = ['label', 'radiusMeters', 'daysMask', 'expectedArrivalMinute', 'expectedDepartureMinute', 'toleranceMinutes', 'isConfirmed', 'isActive'];
        const updates = {};
        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        }

        // When a guardian explicitly confirms an anchor, mark it
        if (updates.isConfirmed === true || updates.label) {
            updates.isConfirmed = true;
        }

        await anchor.update(updates);

        res.status(200).json({
            success: true,
            data: anchor,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Delete / deactivate a routine anchor
 * @route   DELETE /api/routine/anchors/:id
 * @access  Private
 */
exports.deleteAnchor = async (req, res) => {
    try {
        const anchor = await RoutineAnchor.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });

        if (!anchor) {
            return res.status(404).json({
                success: false,
                message: 'Routine anchor not found or not authorized.',
            });
        }

        await anchor.destroy();

        res.status(200).json({
            success: true,
            message: 'Routine anchor removed successfully.',
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Trigger routine learning from GPS history (on-demand)
 * @route   POST /api/routine/learn
 * @access  Private
 */
exports.triggerLearning = async (req, res) => {
    try {
        const newAnchors = await learnRoutineAnchors(req.user.id);

        res.status(200).json({
            success: true,
            message: `Routine learning complete. ${newAnchors.length} new anchor(s) discovered.`,
            newAnchorsCount: newAnchors.length,
            data: newAnchors,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get recent routine deviations for logged-in user
 * @route   GET /api/routine/deviations
 * @access  Private
 */
exports.getDeviations = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const includeAcknowledged = req.query.includeAcknowledged === 'true';

        const whereClause = { userId: req.user.id };
        if (!includeAcknowledged) {
            whereClause.isAcknowledged = false;
        }

        const deviations = await RoutineDeviation.findAll({
            where: whereClause,
            include: [{
                model: RoutineAnchor,
                as: 'anchor',
                attributes: ['id', 'label', 'latitude', 'longitude'],
            }],
            order: [['detectedAt', 'DESC']],
            limit,
        });

        res.status(200).json({
            success: true,
            count: deviations.length,
            data: deviations,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Get deviations for a specific ward (guardian view)
 * @route   GET /api/routine/deviations/ward/:wardUserId
 * @access  Private (guardian must be a trusted contact of the ward)
 */
exports.getWardDeviations = async (req, res) => {
    try {
        const { wardUserId } = req.params;
        const TrustedContact = require('../models/TrustedContact');
        const User = require('../models/User');

        // Verify the requesting user is a guardian of the ward
        const callingUser = await User.findByPk(req.user.id);
        if (!callingUser) {
            return res.status(401).json({ success: false, message: 'User not found.' });
        }

        const { Op } = require('sequelize');
        const isGuardian = await TrustedContact.findOne({
            where: {
                userId: wardUserId,
                [Op.or]: [
                    { contactEmail: callingUser.email },
                    ...(callingUser.phoneNumber ? [{ contactPhone: callingUser.phoneNumber }] : []),
                ],
            },
        });

        if (!isGuardian) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to view this ward\'s routine deviations.',
            });
        }

        const limit = parseInt(req.query.limit) || 20;
        const deviations = await RoutineDeviation.findAll({
            where: { userId: wardUserId, isAcknowledged: false },
            include: [{
                model: RoutineAnchor,
                as: 'anchor',
                attributes: ['id', 'label', 'latitude', 'longitude'],
            }],
            order: [['detectedAt', 'DESC']],
            limit,
        });

        res.status(200).json({
            success: true,
            count: deviations.length,
            data: deviations,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Acknowledge / dismiss a routine deviation
 * @route   PUT /api/routine/deviations/:id/acknowledge
 * @access  Private
 */
exports.acknowledgeDeviation = async (req, res) => {
    try {
        const deviation = await RoutineDeviation.findOne({
            where: { id: req.params.id, userId: req.user.id },
        });

        if (!deviation) {
            return res.status(404).json({
                success: false,
                message: 'Deviation not found or not authorized.',
            });
        }

        await deviation.update({ isAcknowledged: true });

        res.status(200).json({
            success: true,
            message: 'Deviation acknowledged.',
            data: deviation,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
