const express = require('express');
const {
    addContact,
    getContacts,
    getGuardianshipContacts,
    createGuardianTrackerSession,
    deleteContact,
    updateSharingMode
} = require('../controllers/contactController');
const { protect } = require('../middleware/auth');

const router = express.Router();

router.post('/', protect, addContact);
router.get('/', protect, getContacts);
router.get('/guardianship', protect, getGuardianshipContacts);
router.post('/guardianship/:accessCode/session', protect, createGuardianTrackerSession);
router.delete('/:id', protect, deleteContact);
router.put('/:id/sharing-mode', protect, updateSharingMode);

module.exports = router;
