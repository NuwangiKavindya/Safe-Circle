const express = require('express');
const {
    getAnchors,
    createAnchor,
    updateAnchor,
    deleteAnchor,
    triggerLearning,
    getDeviations,
    getWardDeviations,
    acknowledgeDeviation,
} = require('../controllers/routineController');
const { protect } = require('../middleware/auth');

const router = express.Router();

// ── Routine Anchors ──
router.get('/anchors', protect, getAnchors);
router.post('/anchors', protect, createAnchor);
router.put('/anchors/:id', protect, updateAnchor);
router.delete('/anchors/:id', protect, deleteAnchor);

// ── Routine Learning ──
router.post('/learn', protect, triggerLearning);

// ── Routine Deviations ──
router.get('/deviations', protect, getDeviations);
router.get('/deviations/ward/:wardUserId', protect, getWardDeviations);
router.put('/deviations/:id/acknowledge', protect, acknowledgeDeviation);

module.exports = router;
