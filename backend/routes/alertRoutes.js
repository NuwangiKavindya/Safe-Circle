const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { triggerAlert, resolveAlert, getActiveAlerts, uploadAmbientAudio } = require('../controllers/alertController');
const { protect } = require('../middleware/auth');

// Ensure audio uploads directory exists
const uploadDir = path.join(__dirname, '../uploads/audio');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        const ext = path.extname(file.originalname) || '.m4a';
        cb(null, `audio-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('audio/') || file.originalname.match(/\.(mp3|wav|m4a|aac|ogg|3gp)$/i)) {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type. Only audio recordings are allowed.'));
        }
    }
});

const router = express.Router();

router.post('/', protect, triggerAlert);
router.put('/:id/resolve', protect, resolveAlert);
router.get('/active', protect, getActiveAlerts);
router.post('/:id/audio', protect, upload.single('audio'), uploadAmbientAudio);

module.exports = router;

