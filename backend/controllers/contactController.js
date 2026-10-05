const { Op } = require('sequelize');
const TrustedContact = require('../models/TrustedContact');
const User = require('../models/User');
const Alert = require('../models/Alert');
const Device = require('../models/Device');
const pushService = require('../services/pushService');
const emailService = require('../services/emailService');
const { generateURI } = require('../utils/totp');
const jwt = require('jsonwebtoken');

/**
 * Helper to generate comprehensive phone number variants for cross-format matching.
 * Handles: international prefix (+94, 94), domestic leading 0 (077), core 9-10 digits (77xxxxxxx),
 * and stripping non-numeric punctuation.
 */
function getPhoneNumberVariants(phoneNumber) {
    if (!phoneNumber) return [];
    const clean = String(phoneNumber).replace(/[\s\-\(\)\.]/g, '').trim();
    if (!clean) return [];

    const variants = new Set();
    variants.add(clean);

    const digitsOnly = clean.replace(/\D/g, '');
    if (digitsOnly) {
        variants.add(digitsOnly);

        // Core 9-digit suffix (e.g. Sri Lankan mobile 771234567 from +94771234567 or 0771234567)
        if (digitsOnly.length >= 9) {
            const core9 = digitsOnly.slice(-9);
            variants.add(core9);
            variants.add('0' + core9);
            variants.add('+94' + core9);
            variants.add('94' + core9);
        }

        // Core 10-digit suffix (e.g. US/India mobile)
        if (digitsOnly.length >= 10) {
            const core10 = digitsOnly.slice(-10);
            variants.add(core10);
            variants.add('0' + core10);
            variants.add('1' + core10);
            variants.add('+1' + core10);
        }

        if (clean.startsWith('+')) {
            variants.add(clean.slice(1));
        } else {
            variants.add('+' + clean);
        }

        if (clean.startsWith('0')) {
            variants.add(clean.slice(1));
        }
    }

    return Array.from(variants).filter(v => v && v.length >= 7);
}

/**
 * @desc    Add a trusted contact with intelligent channel prioritization
 * @route   POST /api/contacts
 * @access  Private
 */
exports.addContact = async (req, res) => {
    try {
        const { contactName, contactPhone, contactEmail, relationship } = req.body;

        // Validation
        if (!contactName || !contactPhone) {
            return res.status(400).json({
                success: false,
                message: 'Please provide both contactName and contactPhone',
            });
        }

        // Sanitize phone & email
        const cleanPhone = contactPhone.replace(/[\s\-\(\)\.]/g, '').trim();
        const cleanEmail = contactEmail && contactEmail.trim() ? contactEmail.toLowerCase().trim() : null;

        // Intelligent Channel Prioritization: Check if contact is an existing SafeCircle member
        const phoneVariants = getPhoneNumberVariants(cleanPhone);
        const whereConditions = [];
        phoneVariants.forEach(p => {
            whereConditions.push({ phoneNumber: { [Op.iLike]: `%${p}%` } });
        });
        if (cleanEmail) {
            whereConditions.push({ email: cleanEmail });
        }

        const registeredUser = await User.findOne({
            where: { [Op.or]: whereConditions },
            include: [{ model: Device, as: 'devices' }]
        });

        // If registeredUser has an email and none was provided, auto-link email for robust identification
        const finalEmail = cleanEmail || (registeredUser ? registeredUser.email : null);

        // 1. Create contact (beforeCreate hook generates accessCode handle + totpSecret)
        const contact = await TrustedContact.create({
            userId: req.user.id,
            contactName,
            contactPhone: cleanPhone,
            contactEmail: finalEmail,
            relationship,
            isVerified: false
        });

        // 2. Build TOTP provisioning URI for the trusted contact's authenticator app.
        //    Format: otpauth://totp/<label>?secret=<base32>&issuer=SafeCircle&algorithm=SHA1&digits=6&period=30
        //    The contact scans this as a QR code into Google Authenticator / Authy.
        //    The raw totpSecret is NOT included in this response for security.
        const totpProvisioningUri = generateURI(contactName, contact.totpSecret, 'SafeCircle');

        let delivery = {
            isRegisteredUser: false,
            deliveryChannel: 'NONE',
            message: ''
        };

        if (registeredUser) {
            delivery.isRegisteredUser = true;
            delivery.deliveryChannel = 'PUSH_NOTIFICATION';
            delivery.message = `${registeredUser.fullName || contactName} is already on SafeCircle. In-app notification sent.`;
            delivery.targetUserId = registeredUser.id;

            const fcmTokens = (registeredUser.devices || [])
                .map(d => d.fcmToken)
                .filter(t => t && t.trim().length > 0);

            await pushService.sendGuardianInvitePushNotification(fcmTokens, {
                ownerName: req.user.fullName || 'SafeCircle User',
                ownerPhone: req.user.phoneNumber,
                wardId: req.user.id,
                relationship: relationship || 'Guardian'
            });
        } else if (finalEmail) {
            delivery.isRegisteredUser = false;
            delivery.deliveryChannel = 'EMAIL_INVITATION';
            delivery.message = `Invitation email with access code dispatched to ${finalEmail}.`;

            await emailService.sendGuardianInvitationEmail({
                recipientEmail: finalEmail,
                recipientName: contactName,
                senderName: req.user.fullName || 'SafeCircle User',
                senderPhone: req.user.phoneNumber,
                accessCode: contact.accessCode,
                relationship: relationship || 'Guardian',
                totpProvisioningUri,
                totpSecret: contact.totpSecret
            });
        } else {
            delivery.isRegisteredUser = false;
            delivery.deliveryChannel = 'MANUAL_SHARE';
            delivery.message = `${contactName} is not on SafeCircle. Share access code via WhatsApp or SMS.`;
        }

        // Return contact data (totpSecret excluded) + provisioning URI for QR code generation
        const safeContact = {
            id: contact.id,
            userId: contact.userId,
            contactName: contact.contactName,
            contactPhone: contact.contactPhone,
            contactEmail: contact.contactEmail,
            relationship: contact.relationship,
            isVerified: contact.isVerified,
            accessCode: contact.accessCode,
            sharingMode: contact.sharingMode,
            createdAt: contact.createdAt,
            updatedAt: contact.updatedAt,
        };

        res.status(201).json({
            success: true,
            data: safeContact,
            totpProvisioningUri,   // For QR code generation in the frontend
            delivery
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};


/**
 * @desc    Get all trusted contacts for logged in user
 * @route   GET /api/contacts
 * @access  Private
 */
exports.getContacts = async (req, res) => {
    try {
        const contacts = await TrustedContact.findAll({
            where: { userId: req.user.id },
            order: [['createdAt', 'DESC']]
        });

        res.status(200).json({
            success: true,
            count: contacts.length,
            data: contacts
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * @desc    Get all users who have added the logged-in user as their trusted contact (Guardianship Circle)
 * @route   GET /api/contacts/guardianship
 * @access  Private
 */
exports.getGuardianshipContacts = async (req, res) => {
    try {
        const currentUser = req.user;

        const phoneVariants = getPhoneNumberVariants(currentUser.phoneNumber);

        const orConditions = [];
        phoneVariants.forEach(p => {
            orConditions.push({ contactPhone: { [Op.iLike]: `%${p}%` } });
        });

        if (currentUser.email) {
            orConditions.push({ contactEmail: { [Op.iLike]: currentUser.email.trim() } });
        }

        if (orConditions.length === 0) {
            return res.status(200).json({
                success: true,
                count: 0,
                data: []
            });
        }

        // 1. Find all contact entries where the phone or email matches the current user
        const contacts = await TrustedContact.findAll({
            where: {
                [Op.or]: orConditions
            },
            include: [
                {
                    model: User,
                    as: 'user',
                    attributes: ['id', 'fullName', 'email', 'phoneNumber']
                }
            ],
            order: [['createdAt', 'DESC']]
        });

        // 2. Fetch active emergency SOS status for each ward
        const wardUserIds = contacts.map(c => c.userId);
        const activeAlerts = await Alert.findAll({
            where: {
                userId: wardUserIds,
                status: 'ACTIVE'
            }
        });

        const activeAlertMap = new Map();
        activeAlerts.forEach(a => activeAlertMap.set(a.userId, a));

        // 3. Format response payload
        const formattedData = contacts.map(contact => {
            const activeAlert = activeAlertMap.get(contact.userId);
            return {
                contactId: contact.id,
                accessCode: contact.accessCode,
                relationship: contact.relationship,
                sharingMode: contact.sharingMode || 'EMERGENCY_ONLY',
                isVerified: contact.isVerified,
                wardUser: {
                    id: contact.user ? contact.user.id : contact.userId,
                    fullName: contact.user ? contact.user.fullName : contact.contactName,
                    phoneNumber: contact.user ? contact.user.phoneNumber : '',
                    email: contact.user ? contact.user.email : ''
                },
                isActiveSos: !!activeAlert,
                alertDetails: activeAlert ? {
                    id: activeAlert.id,
                    alertType: activeAlert.alertType,
                    latitude: activeAlert.latitude,
                    longitude: activeAlert.longitude,
                    createdAt: activeAlert.createdAt
                } : null
            };
        });

        res.status(200).json({
            success: true,
            count: formattedData.length,
            data: formattedData
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Start an authenticated tracker session for a registered guardian (1-tap in-app tracking)
 * @route   POST /api/contacts/guardianship/:accessCode/session
 * @access  Private (Logged-in guardian with valid User JWT)
 */
exports.createGuardianTrackerSession = async (req, res) => {
    try {
        const { accessCode } = req.params;
        const currentUser = req.user;

        // 1. Find the contact relationship by accessCode
        const contact = await TrustedContact.findOne({
            where: { accessCode },
            include: [{ model: User, as: 'user' }]
        });

        if (!contact) {
            return res.status(404).json({
                success: false,
                message: 'Ward contact record not found.'
            });
        }

        // 2. Verify that req.user is authorized to protect this ward
        const phoneVariants = getPhoneNumberVariants(currentUser.phoneNumber);
        const cleanContactPhone = (contact.contactPhone || '').replace(/[\s\-\(\)\.]/g, '').trim();

        const isPhoneMatch = phoneVariants.some(p => {
            const cleanP = p.replace(/\D/g, '');
            const cleanCP = cleanContactPhone.replace(/\D/g, '');
            return cleanCP.includes(cleanP) || cleanP.includes(cleanCP) || (cleanP.length >= 7 && cleanCP.endsWith(cleanP.slice(-7)));
        });

        const isEmailMatch = currentUser.email && contact.contactEmail &&
            currentUser.email.trim().toLowerCase() === contact.contactEmail.trim().toLowerCase();

        if (!isPhoneMatch && !isEmailMatch) {
            return res.status(403).json({
                success: false,
                message: 'Access denied: You are not designated as the trusted guardian for this contact.'
            });
        }

        // 3. Privacy check: active SOS or ALWAYS_ON mode
        const activeAlert = await Alert.findOne({
            where: { userId: contact.userId, status: 'ACTIVE' }
        });

        const isAlwaysOn = contact.sharingMode === 'ALWAYS_ON';
        if (!activeAlert && !isAlwaysOn) {
            return res.status(403).json({
                success: false,
                message: 'Access Denied: Location sharing is set to Emergency-Only and the ward is not currently in an active SOS emergency state.'
            });
        }

        // 4. Mark contact as verified on successful session creation
        if (!contact.isVerified) {
            contact.isVerified = true;
            await contact.save();
        }

        // 5. Resolve active deviceId for the ward
        let deviceId = activeAlert ? activeAlert.deviceId : null;
        if (!deviceId) {
            const userDevice = await Device.findOne({
                where: { userId: contact.userId },
                order: [['updatedAt', 'DESC']]
            });
            if (userDevice) deviceId = userDevice.id;
        }

        // 6. Issue 2-hour Tracker Session JWT
        const trackerSessionToken = jwt.sign(
            {
                contactId: contact.id,
                userId: contact.userId,
                accessCode: contact.accessCode,
                role: 'TRACKER'
            },
            process.env.JWT_SECRET,
            { expiresIn: '2h' }
        );

        res.status(200).json({
            success: true,
            trackerSessionToken,
            data: {
                contactName: contact.contactName,
                relationship: contact.relationship,
                sharingMode: contact.sharingMode || 'EMERGENCY_ONLY',
                targetUser: {
                    id: contact.user ? contact.user.id : contact.userId,
                    fullName: contact.user ? contact.user.fullName : contact.contactName,
                    phoneNumber: contact.user ? contact.user.phoneNumber : ''
                },
                isActiveSos: !!activeAlert,
                alertId: activeAlert ? activeAlert.id : null,
                deviceId: deviceId,
                audioFileUrl: activeAlert ? activeAlert.audioFileUrl : null
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc    Delete a trusted contact
 * @route   DELETE /api/contacts/:id
 * @access  Private
 */
exports.deleteContact = async (req, res) => {
    try {
        const contact = await TrustedContact.findOne({
            where: {
                id: req.params.id,
                userId: req.user.id
            }
        });

        if (!contact) {
            return res.status(404).json({
                success: false,
                message: 'Trusted contact not found or not authorized'
            });
        }

        await contact.destroy();

        res.status(200).json({
            success: true,
            message: 'Trusted contact removed successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * @desc    Update location sharing mode for a trusted contact
 * @route   PUT /api/contacts/:id/sharing-mode
 * @access  Private
 */
exports.updateSharingMode = async (req, res) => {
    try {
        const { sharingMode } = req.body;
        if (!['EMERGENCY_ONLY', 'ALWAYS_ON'].includes(sharingMode)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid sharing mode. Must be EMERGENCY_ONLY or ALWAYS_ON.',
            });
        }

        const contact = await TrustedContact.findOne({
            where: {
                id: req.params.id,
                userId: req.user.id
            }
        });

        if (!contact) {
            return res.status(404).json({
                success: false,
                message: 'Trusted contact not found or not authorized'
            });
        }

        contact.sharingMode = sharingMode;
        await contact.save();

        res.status(200).json({
            success: true,
            data: contact
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};
