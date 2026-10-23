const { Op } = require('sequelize');
const SafetyCheckin = require('../models/SafetyCheckin');
const Alert = require('../models/Alert');
const User = require('../models/User');
const TrustedContact = require('../models/TrustedContact');
const { dispatchSosNotifications } = require('../utils/notifications');

class CheckinSweeper {
    constructor() {
        this.timer = null;
        this.intervalMs = 30 * 1000; // Check every 30 seconds
        this.isRunning = false;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.timer = setInterval(() => {
            this.sweepExpiredCheckins().catch(err => {
                console.error('[CheckinSweeper] Error sweeping expired check-ins:', err.message);
            });
        }, this.intervalMs);
        if (this.timer.unref) {
            this.timer.unref(); // Don't prevent process exit
        }
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.isRunning = false;
    }

    /**
     * Finds active check-ins whose expiresAt is past, transitions them to EXPIRED,
     * and automatically triggers an escalated SOS alert to guardians.
     */
    async sweepExpiredCheckins() {
        const now = new Date();
        const expiredCheckins = await SafetyCheckin.findAll({
            where: {
                status: 'ACTIVE',
                expiresAt: {
                    [Op.lte]: now
                }
            },
            include: [{ model: User, as: 'user' }]
        });

        if (expiredCheckins.length === 0) return 0;

        for (const checkin of expiredCheckins) {
            try {
                // Create an automated Emergency SOS Alert
                const alert = await Alert.create({
                    userId: checkin.userId,
                    alertType: 'DEAD_MAN_SWITCH_EXPIRED',
                    status: 'ACTIVE',
                    latitude: checkin.destLatitude || checkin.startLatitude || null,
                    longitude: checkin.destLongitude || checkin.startLongitude || null
                });

                // Update check-in record
                checkin.status = 'EXPIRED';
                checkin.alertId = alert.id;
                await checkin.save();

                // Dispatch notification to user's trusted circle
                const contacts = await TrustedContact.findAll({
                    where: { userId: checkin.userId }
                });

                if (checkin.user) {
                    dispatchSosNotifications(checkin.user, contacts, alert).catch(err => {
                        console.error('[CheckinSweeper] Failed dispatching SOS for expired checkin:', err.message);
                    });
                }
            } catch (err) {
                console.error(`[CheckinSweeper] Failed processing expired checkin ${checkin.id}:`, err.message);
            }
        }

        return expiredCheckins.length;
    }
}

module.exports = new CheckinSweeper();
