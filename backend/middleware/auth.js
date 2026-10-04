const jwt = require('jsonwebtoken');
const User = require('../models/User');
const TrustedContact = require('../models/TrustedContact');

exports.protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = await User.findByPk(decoded.id);
        
        if (!req.user) {
             return res.status(401).json({ success: false, message: 'User not found' });
        }
        
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Not authorized to access this route' });
    }
};

/**
 * Middleware to authenticate and authorize emergency tracker sessions
 * Ensures the request provides a valid, unexpired Tracker Session JWT
 * generated upon successful RFC 6238 TOTP verification.
 */
exports.protectTracker = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Not authorized: Missing emergency tracker session token.'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded.role !== 'TRACKER' || !decoded.contactId) {
            return res.status(401).json({
                success: false,
                message: 'Invalid tracker session credentials.'
            });
        }

        const contact = await TrustedContact.findByPk(decoded.contactId, {
            include: [{ model: User, as: 'user' }]
        });

        if (!contact) {
            return res.status(401).json({
                success: false,
                message: 'Trusted contact record not found or revoked.'
            });
        }

        req.trackerContact = contact;
        req.trackerSession = decoded;
        next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Tracker session expired or invalid. Please re-authenticate with TOTP.'
        });
    }
};

/**
 * Middleware allowing either a device owner (User JWT) or an authorized
 * guardian (Tracker Session JWT). Also accepts token passed via ?token= query parameter,
 * which is essential for audio stream players and image/media tags that cannot set headers.
 */
exports.protectAny = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        token = req.headers.authorization.split(' ')[1];
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Not authorized: Missing authentication token.'
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        if (decoded.role === 'TRACKER') {
            if (!decoded.contactId) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid tracker session credentials.'
                });
            }

            const contact = await TrustedContact.findByPk(decoded.contactId, {
                include: [{ model: User, as: 'user' }]
            });

            if (!contact) {
                return res.status(401).json({
                    success: false,
                    message: 'Trusted contact record not found or revoked.'
                });
            }

            req.trackerContact = contact;
            req.trackerSession = decoded;
            req.isTracker = true;
            return next();
        }

        // Regular User
        const user = await User.findByPk(decoded.id);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'User not found.'
            });
        }

        req.user = user;
        req.isTracker = false;
        return next();
    } catch (error) {
        return res.status(401).json({
            success: false,
            message: 'Authentication token expired or invalid.'
        });
    }
};

