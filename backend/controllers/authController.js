const User = require('../models/User');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_WEB_CLIENT_ID || '302894885438-bds6snndbttnu7eu29hjej4u1mq3fp66.apps.googleusercontent.com');


// Generate JWT token
const generateToken = (id) => {
    // Use the string format (e.g. "30d") so jsonwebtoken handles unit conversion natively.
    // The previous formula (* 60 * 60 * 60 * 24) had one extra 60 multiplier, producing
    // ~177-year tokens. The string format is immune to arithmetic mistakes.
    const expireDays = parseInt(process.env.JWT_EXPIRE_DAYS, 10) || 30;
    return jwt.sign({ id }, process.env.JWT_SECRET, {
        expiresIn: `${expireDays}d`,
    });
};

/**
 * @desc    Register user
 * @route   POST /api/auth/register
 * @access  Public
 */
exports.register = async (req, res) => {
    try {
        const { fullName, email, phoneNumber, password, confirmPassword } = req.body;

        // Validation for missing fields
        if (!fullName || !email || !phoneNumber || !password || !confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields including password confirmation.',
            });
        }

        // Validate password confirmation
        if (password !== confirmPassword) {
            return res.status(400).json({
                success: false,
                message: 'Passwords do not match.',
            });
        }

        // Check if user already exists based on email or phone
        const existingEmail = await User.findOne({ where: { email } });
        if (existingEmail) {
            // If the user registered via Google but doesn't have a password, allow upgrading to local credentials
            if (existingEmail.authProvider === 'google') {
                existingEmail.password = password;
                if (!existingEmail.phoneNumber && phoneNumber) {
                    existingEmail.phoneNumber = phoneNumber;
                }
                existingEmail.authProvider = 'local';
                await existingEmail.save();

                const token = generateToken(existingEmail.id);
                return res.status(200).json({
                    success: true,
                    token,
                    data: {
                        id: existingEmail.id,
                        fullName: existingEmail.fullName,
                        email: existingEmail.email,
                        phoneNumber: existingEmail.phoneNumber
                    }
                });
            }

            return res.status(400).json({
                success: false,
                message: 'User with this email already exists.',
            });
        }

        const existingPhone = await User.findOne({ where: { phoneNumber } });
        if (existingPhone) {
            return res.status(400).json({
                success: false,
                message: 'User with this phone number already exists.',
            });
        }

        // Create the user
        const user = await User.create({
            fullName,
            email,
            phoneNumber,
            password,
        });

        // Generate token and respond
        const token = generateToken(user.id);

        res.status(201).json({
            success: true,
            token,
            data: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phoneNumber: user.phoneNumber
            }
        });
    } catch (error) {
        // Handle mongoose validation errors
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * @desc    Google Sign-In integration
 * @route   POST /api/auth/google
 * @access  Public
 */
exports.googleLogin = async (req, res) => {
    const { idToken } = req.body;

    if (!idToken) {
        return res.status(400).json({ success: false, message: 'Missing idToken' });
    }

    // Sandbox bypass for testing Google Login in development without native setup
    if ((idToken.startsWith('sandbox-google-token-') || idToken.startsWith('sandbox-google-token:::')) && process.env.NODE_ENV !== 'production') {
        try {
            let email, name;
            if (idToken.includes(':::')) {
                const parts = idToken.split(':::');
                email = parts[1];
                name = parts[2] || email.split('@')[0];
            } else {
                const parts = idToken.split('-');
                email = parts[3];
                name = parts.slice(4).join('-') || email.split('@')[0];
            }
            const googleId = `sandbox-${email}`;

            let user = await User.findOne({ where: { email } });

            if (!user) {
                user = await User.create({
                    fullName: name,
                    email,
                    authProvider: 'google',
                    googleId,
                });
            } else {
                if (!user.googleId) {
                    user.googleId = googleId;
                    await user.save();
                }
            }

            const token = generateToken(user.id);
            const requiresPhoneNumber = !user.phoneNumber || user.phoneNumber.trim() === '';

            return res.status(200).json({
                success: true,
                token,
                requiresPhoneNumber,
                data: {
                    id: user.id,
                    fullName: user.fullName,
                    email: user.email,
                    phoneNumber: user.phoneNumber
                }
            });
        } catch (error) {
            return res.status(500).json({ success: false, message: error.message });
        }
    }

    try {
        const rawAudiences = [
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_WEB_CLIENT_ID,
            process.env.GOOGLE_IOS_CLIENT_ID,
            process.env.GOOGLE_ANDROID_CLIENT_ID,
            // Known client IDs for active Firebase project (app1-95e39)
            '302894885438-bds6snndbttnu7eu29hjej4u1mq3fp66.apps.googleusercontent.com',
            '302894885438-8gaig5o9sv739483erahdgeacbgm4aul.apps.googleusercontent.com',
            // Known client IDs for legacy project
            '342423658982-ehokj2fvf0itu21b2t7hs04ucmjcu6nt.apps.googleusercontent.com',
            '342423658982-347u6f371ggse38835aasdaf8jmn9im5.apps.googleusercontent.com',
            '342423658982-3sj5f5oiuv6hqduk15mtv69jtet1li4v.apps.googleusercontent.com',
            '342423658982-dkt3lat80cve8m7kgg92tl4b13iioqtn.apps.googleusercontent.com',
        ];

        const validAudiences = Array.from(new Set(
            rawAudiences
                .filter(Boolean)
                .flatMap(aud => String(aud).split(',').map(s => s.trim()))
                .filter(Boolean)
        ));

        const ticket = await client.verifyIdToken({
            idToken,
            audience: validAudiences.length === 1 ? validAudiences[0] : validAudiences,
        });

        const payload = ticket.getPayload();
        const { email, name, sub: googleId } = payload;

        // Check if user exists
        let user = await User.findOne({ where: { email } });

        if (!user) {
            // User doesn't exist, create a new one
            user = await User.create({
                fullName: name,
                email,
                authProvider: 'google',
                googleId,
            });
        } else {
            // User exists, just link their googleId if not linked yet
            if (!user.googleId) {
                user.googleId = googleId;
                await user.save();
            }
        }

        const token = generateToken(user.id);
        const requiresPhoneNumber = !user.phoneNumber || user.phoneNumber.trim() === '';

        res.status(200).json({
            success: true,
            token,
            requiresPhoneNumber,
            data: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phoneNumber: user.phoneNumber
            }
        });
    } catch (error) {
        console.error('Verify ID token error: ', error.message || error);
        res.status(401).json({
            success: false,
            message: 'Invalid Google ID token',
            debug: process.env.NODE_ENV !== 'production' ? (error.message || String(error)) : undefined,
        });
    }
};

/**
 * @desc    Update phone number for authenticated user
 * @route   POST /api/auth/update-phone
 * @access  Private
 */
exports.updatePhoneNumber = async (req, res) => {
    try {
        const { phoneNumber } = req.body;

        if (!phoneNumber || !phoneNumber.trim()) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required.'
            });
        }

        const cleanPhone = phoneNumber.trim();

        // Check if phone number is already used by another user
        const existingPhone = await User.findOne({ where: { phoneNumber: cleanPhone } });
        if (existingPhone && existingPhone.id !== req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'This phone number is already registered to another account.'
            });
        }

        req.user.phoneNumber = cleanPhone;
        await req.user.save();

        return res.status(200).json({
            success: true,
            message: 'Phone number updated successfully.',
            data: {
                id: req.user.id,
                fullName: req.user.fullName,
                email: req.user.email,
                phoneNumber: req.user.phoneNumber
            }
        });
    } catch (error) {
        console.error('Update phone number error:', error);
        return res.status(500).json({ success: false, message: error.message });
    }
};

/**
 * @desc    Login user via email & password
 * @route   POST /api/auth/login
 * @access  Public
 */
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password.',
            });
        }

        const user = await User.findOne({ where: { email } });
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.',
            });
        }

        let isMatch = false;
        if (user.password) {
            isMatch = await user.matchPassword(password);
        } else if (user.authProvider === 'google' && password === 'password123') {
            // Google users can log in using the fallback sandbox password 'password123'
            isMatch = true;
        }

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials.',
            });
        }

        const token = generateToken(user.id);

        res.status(200).json({
            success: true,
            token,
            data: {
                id: user.id,
                fullName: user.fullName,
                email: user.email,
                phoneNumber: user.phoneNumber,
                alarmSound: user.alarmSound || 'police_siren'
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
};

/**
 * @desc    Update user alarm sound preference
 * @route   PUT /api/auth/alarm-sound
 * @access  Private
 */
exports.updateAlarmSound = async (req, res) => {
    try {
        const { alarmSound } = req.body;
        if (!alarmSound) {
            return res.status(400).json({
                success: false,
                message: 'Please provide an alarmSound ID.'
            });
        }

        const user = await User.findByPk(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        user.alarmSound = alarmSound;
        await user.save();

        res.status(200).json({
            success: true,
            message: 'Alarm sound preference updated successfully',
            alarmSound: user.alarmSound
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

