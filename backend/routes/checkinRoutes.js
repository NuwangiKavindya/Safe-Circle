const express = require('express');
const router = express.Router();
const {
    configurePins,
    getPinStatus,
    startCheckin,
    getActiveCheckin,
    extendCheckin,
    updateEscrowPayload,
    verifyAndResolveCheckin,
    getCheckinHistory
} = require('../controllers/checkinController');
const { protect } = require('../middleware/auth');

// All checkin routes require authentication
router.use(protect);

// PIN Management
router.put('/pins', configurePins);
router.get('/pins/status', getPinStatus);

// Active Checkin & Creation
router.route('/')
    .post(startCheckin);

router.get('/active', getActiveCheckin);
router.get('/history', getCheckinHistory);

// Specific Checkin Operations
router.put('/:id/extend', extendCheckin);
router.put('/:id/escrow', updateEscrowPayload);
router.post('/:id/checkin', verifyAndResolveCheckin);

module.exports = router;
