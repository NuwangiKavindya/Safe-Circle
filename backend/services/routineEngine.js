const { Op } = require('sequelize');
const LocationLog = require('../models/LocationLog');
const Device = require('../models/Device');
const RoutineAnchor = require('../models/RoutineAnchor');
const RoutineDeviation = require('../models/RoutineDeviation');

// ─────────────────────────────────────────────────────────────────────────────
// Haversine Distance (meters) between two lat/lon coordinates
// ─────────────────────────────────────────────────────────────────────────────
const haversineMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// ─────────────────────────────────────────────────────────────────────────────
// Convert a dayOfWeek (0=Sunday..6=Saturday) to bitmask value
// Our bitmask: 1=Mon, 2=Tue, 4=Wed, 8=Thu, 16=Fri, 32=Sat, 64=Sun
// ─────────────────────────────────────────────────────────────────────────────
const dayOfWeekToBitmask = (jsDay) => {
    // JS Date.getDay(): 0=Sun, 1=Mon, 2=Tue, ... 6=Sat
    const mapping = [64, 1, 2, 4, 8, 16, 32]; // Sun=64, Mon=1, ...
    return mapping[jsDay] || 0;
};

const bitmaskIncludesDay = (mask, jsDay) => {
    return (mask & dayOfWeekToBitmask(jsDay)) !== 0;
};

// Day name for labeling
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ─────────────────────────────────────────────────────────────────────────────
// minutesFromMidnight — Extract minutes since midnight from a Date
// ─────────────────────────────────────────────────────────────────────────────
const minutesFromMidnight = (date) => {
    return date.getHours() * 60 + date.getMinutes();
};

// ─────────────────────────────────────────────────────────────────────────────
// formatMinutes — Human-readable time from minutes since midnight
// ─────────────────────────────────────────────────────────────────────────────
const formatMinutes = (mins) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// DBSCAN-lite clustering for GPS points
// Groups GPS points that are within `epsMeters` of each other.
// Returns an array of clusters, each with a centroid and member points.
// ─────────────────────────────────────────────────────────────────────────────
const clusterGpsPoints = (points, epsMeters = 150, minPoints = 3) => {
    const visited = new Set();
    const clusters = [];

    for (let i = 0; i < points.length; i++) {
        if (visited.has(i)) continue;
        visited.add(i);

        const neighbors = [];
        for (let j = 0; j < points.length; j++) {
            if (i === j) continue;
            const dist = haversineMeters(
                points[i].latitude, points[i].longitude,
                points[j].latitude, points[j].longitude
            );
            if (dist <= epsMeters) {
                neighbors.push(j);
            }
        }

        if (neighbors.length + 1 < minPoints) continue;

        const cluster = [i];
        const queue = [...neighbors];

        while (queue.length > 0) {
            const idx = queue.shift();
            if (visited.has(idx)) continue;
            visited.add(idx);
            cluster.push(idx);

            for (let k = 0; k < points.length; k++) {
                if (visited.has(k)) continue;
                const dist = haversineMeters(
                    points[idx].latitude, points[idx].longitude,
                    points[k].latitude, points[k].longitude
                );
                if (dist <= epsMeters) {
                    queue.push(k);
                }
            }
        }

        // Compute centroid
        let sumLat = 0, sumLon = 0;
        const memberPoints = cluster.map(idx => points[idx]);
        for (const p of memberPoints) {
            sumLat += p.latitude;
            sumLon += p.longitude;
        }
        clusters.push({
            centroid: {
                latitude: sumLat / memberPoints.length,
                longitude: sumLon / memberPoints.length
            },
            points: memberPoints,
            count: memberPoints.length
        });
    }

    return clusters;
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE: Analyze GPS history for a user and discover routine anchors
// ─────────────────────────────────────────────────────────────────────────────
const learnRoutineAnchors = async (userId) => {
    console.log(`[RoutineEngine] 🧠 Starting routine learning for user ${userId}...`);

    // Get all devices for this user
    const devices = await Device.findAll({ where: { userId } });
    if (devices.length === 0) {
        console.log(`[RoutineEngine] No devices found for user ${userId}. Skipping.`);
        return [];
    }
    const deviceIds = devices.map(d => d.id);

    // Fetch GPS logs from the last 14 days (learning window)
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const logs = await LocationLog.findAll({
        where: {
            deviceId: { [Op.in]: deviceIds },
            timestamp: { [Op.gte]: cutoff }
        },
        order: [['timestamp', 'ASC']],
        raw: true,
    });

    if (logs.length < 20) {
        console.log(`[RoutineEngine] Insufficient GPS data (${logs.length} points). Need at least 20. Skipping.`);
        return [];
    }

    console.log(`[RoutineEngine] Processing ${logs.length} GPS points over 14 days...`);

    // Parse and enrich each log with time metadata
    const enrichedPoints = logs.map(log => ({
        latitude: parseFloat(log.latitude),
        longitude: parseFloat(log.longitude),
        timestamp: new Date(log.timestamp),
        dayOfWeek: new Date(log.timestamp).getDay(),
        minuteOfDay: minutesFromMidnight(new Date(log.timestamp)),
    }));

    // ── Step 1: Spatial Clustering ──
    // Find clusters of points that are geographically close
    const spatialClusters = clusterGpsPoints(enrichedPoints, 150, 5);
    console.log(`[RoutineEngine] Found ${spatialClusters.length} spatial cluster(s).`);

    // ── Step 2: Temporal Analysis per Cluster ──
    // For each spatial cluster, analyze what days and time windows it's visited
    const discoveredAnchors = [];

    for (const cluster of spatialClusters) {
        // Group cluster points by day of week
        const dayGroups = {};
        for (const point of cluster.points) {
            const day = point.dayOfWeek;
            if (!dayGroups[day]) dayGroups[day] = [];
            dayGroups[day].push(point);
        }

        // Build a daysMask from days that have enough observations (≥2 visits)
        let daysMask = 0;
        let allArrivalMinutes = [];
        let allDepartureMinutes = [];

        for (const [dayStr, dayPoints] of Object.entries(dayGroups)) {
            const day = parseInt(dayStr);
            if (dayPoints.length >= 2) {
                daysMask |= dayOfWeekToBitmask(day);
                // Find earliest and latest minute of day for this cluster on this day
                const minutes = dayPoints.map(p => p.minuteOfDay).sort((a, b) => a - b);
                allArrivalMinutes.push(minutes[0]);
                allDepartureMinutes.push(minutes[minutes.length - 1]);
            }
        }

        if (daysMask === 0) continue; // No recurring pattern

        // Median arrival and departure times
        allArrivalMinutes.sort((a, b) => a - b);
        allDepartureMinutes.sort((a, b) => a - b);
        const medianArrival = allArrivalMinutes[Math.floor(allArrivalMinutes.length / 2)];
        const medianDeparture = allDepartureMinutes[Math.floor(allDepartureMinutes.length / 2)];

        // Generate a descriptive label based on time of day
        let timeLabel;
        if (medianArrival < 360) timeLabel = 'Early Morning';
        else if (medianArrival < 540) timeLabel = 'Morning';
        else if (medianArrival < 720) timeLabel = 'Late Morning';
        else if (medianArrival < 840) timeLabel = 'Afternoon';
        else if (medianArrival < 1020) timeLabel = 'Evening';
        else timeLabel = 'Night';

        // Label based on pattern
        const activeDays = [];
        for (let d = 0; d < 7; d++) {
            if (bitmaskIncludesDay(daysMask, d)) activeDays.push(DAY_NAMES[d].substring(0, 3));
        }
        const daysLabel = activeDays.length >= 5 ? 'Weekday' :
                          activeDays.length >= 6 ? 'Daily' :
                          activeDays.join('/');

        const autoLabel = `${timeLabel} Location (${daysLabel})`;

        discoveredAnchors.push({
            latitude: cluster.centroid.latitude,
            longitude: cluster.centroid.longitude,
            daysMask,
            expectedArrivalMinute: medianArrival,
            expectedDepartureMinute: Math.max(medianDeparture, medianArrival + 30),
            observationCount: cluster.count,
            label: autoLabel,
        });
    }

    console.log(`[RoutineEngine] Discovered ${discoveredAnchors.length} routine anchor(s).`);

    // ── Step 3: Merge with existing anchors ──
    // Don't create duplicates — update if close to an existing anchor
    const existingAnchors = await RoutineAnchor.findAll({
        where: { userId, isActive: true }
    });

    const newAnchors = [];
    for (const discovered of discoveredAnchors) {
        let merged = false;
        for (const existing of existingAnchors) {
            const dist = haversineMeters(
                discovered.latitude, discovered.longitude,
                parseFloat(existing.latitude), parseFloat(existing.longitude)
            );
            if (dist < 200) {
                // Update observation count and time windows (don't overwrite confirmed labels)
                await existing.update({
                    observationCount: existing.observationCount + discovered.observationCount,
                    daysMask: existing.daysMask | discovered.daysMask,
                    expectedArrivalMinute: existing.isConfirmed ? existing.expectedArrivalMinute : discovered.expectedArrivalMinute,
                    expectedDepartureMinute: existing.isConfirmed ? existing.expectedDepartureMinute : discovered.expectedDepartureMinute,
                    label: existing.isConfirmed ? existing.label : discovered.label,
                });
                merged = true;
                console.log(`[RoutineEngine] Merged with existing anchor "${existing.label}" (${dist.toFixed(0)}m away)`);
                break;
            }
        }

        if (!merged) {
            const anchor = await RoutineAnchor.create({
                userId,
                ...discovered,
                source: 'LEARNED',
            });
            newAnchors.push(anchor);
            console.log(`[RoutineEngine] Created new anchor: "${discovered.label}" at (${discovered.latitude.toFixed(5)}, ${discovered.longitude.toFixed(5)})`);
        }
    }

    return newAnchors;
};

// ─────────────────────────────────────────────────────────────────────────────
// CORE: Check current location against expected routine and detect deviations
// ─────────────────────────────────────────────────────────────────────────────
const checkRoutineDeviation = async (userId, currentLat, currentLon) => {
    const now = new Date();
    const currentMinute = minutesFromMidnight(now);
    const currentDay = now.getDay();

    // Get active anchors for this user that apply to today
    const anchors = await RoutineAnchor.findAll({
        where: { userId, isActive: true }
    });

    if (anchors.length === 0) return null;

    const deviations = [];

    for (const anchor of anchors) {
        // Skip if anchor doesn't apply to today
        if (!bitmaskIncludesDay(anchor.daysMask, currentDay)) continue;

        const arrival = anchor.expectedArrivalMinute;
        const departure = anchor.expectedDepartureMinute;
        const tolerance = anchor.toleranceMinutes;

        // Check if we're within the expected time window (arrival - tolerance to departure + tolerance)
        const inTimeWindow = currentMinute >= (arrival - tolerance) &&
                             currentMinute <= (departure + tolerance);

        if (!inTimeWindow) continue;

        // Calculate distance from this anchor
        const dist = haversineMeters(
            currentLat, currentLon,
            parseFloat(anchor.latitude), parseFloat(anchor.longitude)
        );

        const isNearAnchor = dist <= anchor.radiusMeters;

        // ── LATE ARRIVAL Detection ──
        // We're past the expected arrival + tolerance, but ward is NOT near the anchor
        if (currentMinute > (arrival + tolerance) && currentMinute < departure && !isNearAnchor) {
            // Check we haven't already flagged this today
            const existingToday = await RoutineDeviation.findOne({
                where: {
                    userId,
                    anchorId: anchor.id,
                    deviationType: 'LATE_ARRIVAL',
                    detectedAt: { [Op.gte]: new Date(now.toDateString()) }
                }
            });

            if (!existingToday) {
                const deviation = await RoutineDeviation.create({
                    userId,
                    anchorId: anchor.id,
                    deviationType: 'LATE_ARRIVAL',
                    actualLatitude: currentLat,
                    actualLongitude: currentLon,
                    distanceFromAnchorMeters: Math.round(dist),
                    severity: dist > 2000 ? 'HIGH' : dist > 500 ? 'MEDIUM' : 'LOW',
                    description: `Expected at "${anchor.label}" by ${formatMinutes(arrival)} but currently ${Math.round(dist)}m away.`,
                    detectedAt: now,
                });
                deviations.push(deviation);
                console.log(`[RoutineEngine] ⚠️ LATE_ARRIVAL detected: ${deviation.description}`);
            }
        }

        // ── EARLY DEPARTURE Detection ──
        // We're before departure - tolerance, ward was near but now isn't
        // (This is checked when we know the ward was previously at the anchor — tracked by observationCount)
        if (currentMinute < (departure - tolerance) && currentMinute > arrival && !isNearAnchor && dist > anchor.radiusMeters * 2) {
            const existingToday = await RoutineDeviation.findOne({
                where: {
                    userId,
                    anchorId: anchor.id,
                    deviationType: 'EARLY_DEPARTURE',
                    detectedAt: { [Op.gte]: new Date(now.toDateString()) }
                }
            });

            if (!existingToday) {
                const deviation = await RoutineDeviation.create({
                    userId,
                    anchorId: anchor.id,
                    deviationType: 'EARLY_DEPARTURE',
                    actualLatitude: currentLat,
                    actualLongitude: currentLon,
                    distanceFromAnchorMeters: Math.round(dist),
                    severity: 'MEDIUM',
                    description: `Left "${anchor.label}" early. Expected to stay until ${formatMinutes(departure)} but is now ${Math.round(dist)}m away.`,
                    detectedAt: now,
                });
                deviations.push(deviation);
                console.log(`[RoutineEngine] ⚠️ EARLY_DEPARTURE detected: ${deviation.description}`);
            }
        }
    }

    // ── UNEXPECTED STOP Detection ──
    // If current location is far from ALL active anchors for today's time window, flag it
    const relevantAnchors = anchors.filter(a =>
        bitmaskIncludesDay(a.daysMask, currentDay) &&
        currentMinute >= (a.expectedArrivalMinute - a.toleranceMinutes) &&
        currentMinute <= (a.expectedDepartureMinute + a.toleranceMinutes)
    );

    if (relevantAnchors.length > 0) {
        const isNearAny = relevantAnchors.some(a => {
            const dist = haversineMeters(
                currentLat, currentLon,
                parseFloat(a.latitude), parseFloat(a.longitude)
            );
            return dist <= a.radiusMeters * 3; // 3x radius as buffer
        });

        if (!isNearAny) {
            const existingToday = await RoutineDeviation.findOne({
                where: {
                    userId,
                    deviationType: 'UNEXPECTED_STOP',
                    detectedAt: { [Op.gte]: new Date(now.toDateString()) },
                    isAcknowledged: false,
                }
            });

            if (!existingToday) {
                const nearestAnchor = relevantAnchors.reduce((nearest, a) => {
                    const dist = haversineMeters(currentLat, currentLon, parseFloat(a.latitude), parseFloat(a.longitude));
                    return !nearest || dist < nearest.dist ? { anchor: a, dist } : nearest;
                }, null);

                const deviation = await RoutineDeviation.create({
                    userId,
                    anchorId: nearestAnchor?.anchor?.id || null,
                    deviationType: 'UNEXPECTED_STOP',
                    actualLatitude: currentLat,
                    actualLongitude: currentLon,
                    distanceFromAnchorMeters: nearestAnchor ? Math.round(nearestAnchor.dist) : null,
                    severity: 'HIGH',
                    description: `At an unexpected location. Nearest expected anchor "${nearestAnchor?.anchor?.label || 'Unknown'}" is ${nearestAnchor ? Math.round(nearestAnchor.dist) + 'm' : 'unknown distance'} away.`,
                    detectedAt: now,
                });
                deviations.push(deviation);
                console.log(`[RoutineEngine] ⚠️ UNEXPECTED_STOP detected: ${deviation.description}`);
            }
        }
    }

    return deviations.length > 0 ? deviations : null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Run routine learning for ALL active users (used by cron job)
// ─────────────────────────────────────────────────────────────────────────────
const learnRoutinesForAllUsers = async () => {
    const User = require('../models/User');
    const users = await User.findAll({
        include: [{ model: Device, as: 'devices' }],
    });

    let totalNewAnchors = 0;
    for (const user of users) {
        if (!user.devices || user.devices.length === 0) continue;
        try {
            const newAnchors = await learnRoutineAnchors(user.id);
            totalNewAnchors += newAnchors.length;
        } catch (err) {
            console.error(`[RoutineEngine] Error learning routine for user ${user.id}: ${err.message}`);
        }
    }
    console.log(`[RoutineEngine] Batch learning complete. ${totalNewAnchors} new anchor(s) created across ${users.length} user(s).`);
    return totalNewAnchors;
};

module.exports = {
    haversineMeters,
    clusterGpsPoints,
    learnRoutineAnchors,
    checkRoutineDeviation,
    learnRoutinesForAllUsers,
    formatMinutes,
    minutesFromMidnight,
    dayOfWeekToBitmask,
    bitmaskIncludesDay,
};
