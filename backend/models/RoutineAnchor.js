const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const User = require('./User');

/**
 * RoutineAnchor — A learned spatial-temporal anchor representing a location
 * the user regularly visits at a specific time window on certain days.
 *
 * The learning engine clusters GPS logs by (dayOfWeek, timeWindow, location)
 * to discover recurring patterns like "School every weekday at 7:30-8:00 AM".
 *
 * Guardians can confirm/rename/delete these anchors to improve accuracy.
 */
const RoutineAnchor = sequelize.define('RoutineAnchor', {
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
    // Human-readable label — auto-generated initially, editable by guardian
    label: {
        type: DataTypes.STRING(100),
        allowNull: false,
        defaultValue: 'Unnamed Location',
        validate: {
            notEmpty: { msg: 'Anchor label cannot be empty' }
        }
    },
    // Centroid coordinates of the cluster
    latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: false,
        validate: {
            min: -90.0,
            max: 90.0
        }
    },
    longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: false,
        validate: {
            min: -180.0,
            max: 180.0
        }
    },
    // How close a GPS reading must be to match this anchor (meters)
    radiusMeters: {
        type: DataTypes.FLOAT,
        allowNull: false,
        defaultValue: 150.0,
        validate: {
            min: 30.0,
            max: 2000.0
        }
    },
    // Days of week this anchor is expected (bitmask: 1=Mon, 2=Tue, 4=Wed, 8=Thu, 16=Fri, 32=Sat, 64=Sun)
    daysMask: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 31, // Mon-Fri by default
        validate: {
            min: 0,
            max: 127
        }
    },
    // Expected arrival and departure time windows (minutes from midnight, e.g. 450 = 7:30 AM)
    expectedArrivalMinute: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 480, // 8:00 AM
        validate: {
            min: 0,
            max: 1439
        }
    },
    expectedDepartureMinute: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 900, // 3:00 PM
        validate: {
            min: 0,
            max: 1439
        }
    },
    // Tolerance in minutes for arrival/departure before triggering a deviation
    toleranceMinutes: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 30,
        validate: {
            min: 5,
            max: 120
        }
    },
    // How many times this anchor has been observed (confidence metric)
    observationCount: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: {
            min: 0
        }
    },
    // Whether a guardian has explicitly confirmed this anchor
    isConfirmed: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    // Whether this anchor is actively used for deviation checks
    isActive: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    // Source: 'LEARNED' (auto-discovered) or 'MANUAL' (guardian-created)
    source: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: 'LEARNED',
        validate: {
            isIn: [['LEARNED', 'MANUAL']]
        }
    }
}, {
    timestamps: true,
    indexes: [
        {
            name: 'routine_anchors_user_active_idx',
            fields: ['userId', 'isActive'],
        }
    ]
});

// Relationships
User.hasMany(RoutineAnchor, { foreignKey: 'userId', as: 'routineAnchors' });
RoutineAnchor.belongsTo(User, { foreignKey: 'userId', as: 'user' });

module.exports = RoutineAnchor;
