const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');
const Device = require('./Device');

const LocationLog = sequelize.define('LocationLog', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    deviceId: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: Device,
            key: 'id'
        }
    },
    latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: false,
        validate: {
            notNull: { msg: 'Please add latitude' },
            min: -90.0,
            max: 90.0
        }
    },
    longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: false,
        validate: {
            notNull: { msg: 'Please add longitude' },
            min: -180.0,
            max: 180.0
        }
    },
    accuracy: {
        type: DataTypes.DECIMAL(6, 2),
        allowNull: true
    },
    timestamp: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    }
}, {
    timestamps: true,
    // FIX: Composite index on (deviceId, timestamp) to prevent full-table scans
    // when querying a device's location history. Without this index, history
    // queries degrade to O(n) scans as the LocationLog table grows unboundedly.
    indexes: [
        {
            name: 'location_logs_device_timestamp_idx',
            fields: ['deviceId', 'timestamp'],
        }
    ]
});

// Setup relationships
Device.hasMany(LocationLog, { foreignKey: 'deviceId', as: 'locationLogs' });
LocationLog.belongsTo(Device, { foreignKey: 'deviceId', as: 'device' });

module.exports = LocationLog;
