const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const User = require('./User');
const Alert = require('./Alert');

const SafetyCheckin = sequelize.define('SafetyCheckin', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    userId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: User,
            key: 'id'
        }
    },
    title: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'Safety Escort'
    },
    destination: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    destLatitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
        validate: { min: -90.0, max: 90.0 }
    },
    destLongitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
        validate: { min: -180.0, max: 180.0 }
    },
    startLatitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
        validate: { min: -90.0, max: 90.0 }
    },
    startLongitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
        validate: { min: -180.0, max: 180.0 }
    },
    durationMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 15,
        validate: { min: 1, max: 1440 }
    },
    expiresAt: {
        type: DataTypes.DATE,
        allowNull: false
    },
    status: {
        type: DataTypes.ENUM('ACTIVE', 'COMPLETED', 'EXPIRED', 'DURESS_TRIGGERED', 'CANCELLED'),
        defaultValue: 'ACTIVE',
        allowNull: false
    },
    notes: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    escrowPayload: {
        type: DataTypes.JSONB,
        allowNull: true,
        comment: 'Encrypted snapshot bundle: GPS trail, last-known cell tower, Wi-Fi BSSIDs, battery, ambient audio link'
    },
    duressTriggered: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        allowNull: false
    },
    alertId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: Alert,
            key: 'id'
        }
    },
    completedAt: {
        type: DataTypes.DATE,
        allowNull: true
    }
}, {
    timestamps: true,
    indexes: [
        { fields: ['userId', 'status'] },
        { fields: ['expiresAt', 'status'] }
    ]
});

// Relationships
User.hasMany(SafetyCheckin, { foreignKey: 'userId', as: 'safetyCheckins', onDelete: 'CASCADE' });
SafetyCheckin.belongsTo(User, { foreignKey: 'userId', as: 'user' });

Alert.hasOne(SafetyCheckin, { foreignKey: 'alertId', as: 'safetyCheckin', onDelete: 'SET NULL' });
SafetyCheckin.belongsTo(Alert, { foreignKey: 'alertId', as: 'alert' });

module.exports = SafetyCheckin;
