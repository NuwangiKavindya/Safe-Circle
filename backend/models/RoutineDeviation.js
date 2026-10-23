const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const User = require('./User');
const RoutineAnchor = require('./RoutineAnchor');

/**
 * RoutineDeviation — Records instances where the ward's actual location
 * deviated from their expected routine pattern.
 *
 * Types:
 *   LATE_ARRIVAL    — Ward hasn't arrived at the expected anchor by (expectedArrival + tolerance)
 *   EARLY_DEPARTURE — Ward left the expected anchor before (expectedDeparture - tolerance)
 *   UNEXPECTED_STOP — Ward is stationary at an unrecognized location during a transit window
 *   MISSED_ANCHOR   — Ward completely skipped an expected anchor for the day
 */
const RoutineDeviation = sequelize.define('RoutineDeviation', {
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
    anchorId: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: RoutineAnchor,
            key: 'id'
        }
    },
    deviationType: {
        type: DataTypes.STRING(30),
        allowNull: false,
        validate: {
            isIn: [['LATE_ARRIVAL', 'EARLY_DEPARTURE', 'UNEXPECTED_STOP', 'MISSED_ANCHOR']]
        }
    },
    // Ward's actual location at the time of the deviation
    actualLatitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: true,
        validate: {
            min: -90.0,
            max: 90.0
        }
    },
    actualLongitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: true,
        validate: {
            min: -180.0,
            max: 180.0
        }
    },
    // How far from the expected anchor (meters)
    distanceFromAnchorMeters: {
        type: DataTypes.FLOAT,
        allowNull: true,
    },
    // Human-readable description of the deviation
    description: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    // Severity: LOW, MEDIUM, HIGH
    severity: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: 'MEDIUM',
        validate: {
            isIn: [['LOW', 'MEDIUM', 'HIGH']]
        }
    },
    // Whether guardian has acknowledged/dismissed this deviation
    isAcknowledged: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    // Whether a push notification was sent for this deviation
    notificationSent: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
    },
    detectedAt: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
    }
}, {
    timestamps: true,
    indexes: [
        {
            name: 'routine_deviations_user_detected_idx',
            fields: ['userId', 'detectedAt'],
        },
        {
            name: 'routine_deviations_acknowledged_idx',
            fields: ['userId', 'isAcknowledged'],
        }
    ]
});

// Relationships
User.hasMany(RoutineDeviation, { foreignKey: 'userId', as: 'routineDeviations' });
RoutineDeviation.belongsTo(User, { foreignKey: 'userId', as: 'user' });

RoutineAnchor.hasMany(RoutineDeviation, { foreignKey: 'anchorId', as: 'deviations' });
RoutineDeviation.belongsTo(RoutineAnchor, { foreignKey: 'anchorId', as: 'anchor' });

module.exports = RoutineDeviation;
