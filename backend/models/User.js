const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const bcrypt = require('bcryptjs');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    fullName: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
            notNull: { msg: 'Please add a full name' },
            notEmpty: { msg: 'Please add a full name' }
        }
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: {
            msg: 'User with this email already exists'
        },
        validate: {
            isEmail: { msg: 'Please add a valid email' },
            notNull: { msg: 'Please add an email' }
        }
    },
    phoneNumber: {
        type: DataTypes.STRING(20),
        allowNull: true,
        unique: {
            msg: 'User with this phone number already exists'
        },
        validate: {
            isLocal(value) {
                if (this.authProvider === 'local' && !value) {
                    throw new Error('Please add a phone number');
                }
            }
        }
    },
    password: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
            isLocal(value) {
                if (this.authProvider === 'local' && !value) {
                    throw new Error('Please add a password');
                }
            },
            len: { args: [6, 100], msg: 'Password must be at least 6 characters' }
        }
    },
    authProvider: {
        type: DataTypes.STRING,
        defaultValue: 'local'
    },
    googleId: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true
    },
    fcmToken: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    alarmSound: {
        type: DataTypes.STRING(50),
        defaultValue: 'police_siren',
        allowNull: true
    },
    safetyPin: {
        type: DataTypes.STRING,
        allowNull: true
    },
    duressPin: {
        type: DataTypes.STRING,
        allowNull: true
    }
}, {
    timestamps: true,
    hooks: {
        beforeSave: async (user) => {
            if (user.changed('password')) {
                const salt = await bcrypt.genSalt(10);
                user.password = await bcrypt.hash(user.password, salt);
            }
            if (user.changed('safetyPin') && user.safetyPin) {
                const salt = await bcrypt.genSalt(10);
                user.safetyPin = await bcrypt.hash(user.safetyPin, salt);
            }
            if (user.changed('duressPin') && user.duressPin) {
                const salt = await bcrypt.genSalt(10);
                user.duressPin = await bcrypt.hash(user.duressPin, salt);
            }
        }
    }
});

// Instance method to check password
User.prototype.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Instance method to verify PIN (returns { valid: boolean, isDuress: boolean })
User.prototype.verifyPin = async function (enteredPin) {
    if (!enteredPin) return { valid: false, isDuress: false };
    
    // Check duress PIN first if configured
    if (this.duressPin) {
        const isDuress = await bcrypt.compare(enteredPin, this.duressPin);
        if (isDuress) {
            return { valid: true, isDuress: true };
        }
    }
    
    // Check normal safety PIN
    if (this.safetyPin) {
        const isNormal = await bcrypt.compare(enteredPin, this.safetyPin);
        if (isNormal) {
            return { valid: true, isDuress: false };
        }
    }
    
    return { valid: false, isDuress: false };
};

module.exports = User;
