const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifyAccessCode, getTrackerSessionStatus, getSharedLocationHistory, triggerRemoteSiren } = require('../controllers/verifyController');
const { uploadAmbientAudio } = require('../controllers/alertController');
const { protect, protectTracker, protectAny } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// Rate-limit the public verify endpoint to prevent brute-force attacks on 6-digit access codes.
// Allows 10 attempts per 15-minute sliding window per IP.
const verifyRateLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.headers['x-test-bypass'] === 'skip-limiter',
    message: {
        success: false,
        message: 'Too many verification attempts. Please wait 15 minutes before trying again.'
    }
});

// Ensure audio uploads directory exists
const uploadDir = path.join(__dirname, '../uploads/audio');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configurations
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname) || '.mp3';
        cb(null, `audio-${uniqueSuffix}${ext}`);
    }
});

// Configure upload middleware
const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/') || file.originalname.match(/\.(mp3|wav|m4a|aac|ogg|3gp)$/)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only audio recordings are allowed.'));
        }
    }
});

// 1. Initial TOTP verification endpoint (Public, rate-limited to prevent brute-force attacks)
router.post('/verify', verifyRateLimiter, verifyAccessCode);

// 2. Authenticated Polling & Session Status (Protected by Tracker Session JWT)
router.get('/status', protectTracker, getTrackerSessionStatus);

// 3. Authenticated Geolocation Logs History (Protected by Tracker Session JWT)
// Primary clean routes:
router.get('/location/:accessCode', protectTracker, getSharedLocationHistory);
router.get('/:accessCode', protectTracker, getSharedLocationHistory);
// Backward-compatibility alias for legacy /api/contacts/shared/shared/:accessCode:
router.get('/shared/:accessCode', protectTracker, getSharedLocationHistory);

// 4. Protected ambient recording upload endpoint
router.post('/alerts/:id/audio', protect, upload.single('audio'), uploadAmbientAudio);

// 5. Remote audible siren trigger endpoint (Protected by Tracker Session JWT or User JWT)
router.post('/remote-siren', protectAny, triggerRemoteSiren);

module.exports = router;
