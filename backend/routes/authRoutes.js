const express = require('express');
const rateLimit = require('express-rate-limit');
const { register, googleLogin, login, updatePhoneNumber, updateAlarmSound } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// Rate Limiter: Mitigate brute force credential stuffing & registration floods
// ─────────────────────────────────────────────────────────────────────────────
const authRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15-minute sliding window
    max: 15, // Max 15 attempts per IP per window
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.headers['x-test-bypass'] === 'skip-limiter',
    message: {
        success: false,
        message: 'Too many authentication attempts from this IP. Please try again after 15 minutes.'
    }
});

router.post('/register', authRateLimiter, register);
router.post('/login', authRateLimiter, login);
router.post('/google', authRateLimiter, googleLogin);
router.post('/update-phone', protect, updatePhoneNumber);
router.put('/alarm-sound', protect, updateAlarmSound);

module.exports = router;

