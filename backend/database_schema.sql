-- Connect to the safe_circle database 
-- \c safe_circle

-- 1. Create the User Registration Table
CREATE TABLE IF NOT EXISTS "Users" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "fullName" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL UNIQUE,
    "phoneNumber" VARCHAR(20) UNIQUE,
    "password" VARCHAR(255),
    "authProvider" VARCHAR(50) DEFAULT 'local',
    "googleId" VARCHAR(255) UNIQUE,
    "fcmToken" TEXT,
    "alarmSound" VARCHAR(50) DEFAULT 'police_siren',
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 2. Create the Device Registration Table
CREATE TABLE IF NOT EXISTS "Devices" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "deviceName" VARCHAR(255) NOT NULL,
    "deviceModel" VARCHAR(255) NOT NULL,
    "imeiNumber" VARCHAR(255) NOT NULL UNIQUE,
    "deviceOs"  VARCHAR(255) NOT NULL,
    "fcmToken"  TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 3. Create the Trusted Contacts Table (with RFC 6238 TOTP fields)
CREATE TABLE IF NOT EXISTS "TrustedContacts" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "contactName" VARCHAR(255) NOT NULL,
    "contactPhone" VARCHAR(20) NOT NULL,
    "contactEmail" VARCHAR(255),
    "relationship" VARCHAR(100),
    "isVerified" BOOLEAN DEFAULT false NOT NULL,
    "accessCode" VARCHAR(20) UNIQUE,
    "totpSecret" TEXT,
    "sharingMode" VARCHAR(20) DEFAULT 'EMERGENCY_ONLY' NOT NULL,
    "lastUsedTotpToken" VARCHAR(10),
    "lastTotpUsedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 4. Create the Device Location Logs Table
CREATE TABLE IF NOT EXISTS "LocationLogs" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "deviceId" UUID NOT NULL REFERENCES "Devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "latitude" DECIMAL(10, 8) NOT NULL,
    "longitude" DECIMAL(11, 8) NOT NULL,
    "accuracy" DECIMAL(6, 2),
    "timestamp" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 5. Create the Alerts Table
CREATE TABLE IF NOT EXISTS "Alerts" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "deviceId" UUID REFERENCES "Devices" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "alertType" VARCHAR(100) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'ACTIVE' NOT NULL,
    "latitude" DECIMAL(10, 8),
    "longitude" DECIMAL(11, 8),
    "resolvedAt" TIMESTAMP WITH TIME ZONE,
    "audioFileUrl" VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 6. Create the Safe Zones (Geofencing) Table
CREATE TABLE IF NOT EXISTS "SafeZones" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "zoneName" VARCHAR(100) NOT NULL,
    "latitude" DECIMAL(10, 8) NOT NULL,
    "longitude" DECIMAL(11, 8) NOT NULL,
    "radiusMeters" FLOAT DEFAULT 200.0 NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 7. Create the System Usability Scale (SUS) Study Feedback Table
CREATE TABLE IF NOT EXISTS "SusFeedbacks" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "participantId" VARCHAR(255) NOT NULL,
    "participantRole" VARCHAR(100) DEFAULT 'Student',
    "task1TimeSec" FLOAT DEFAULT 45.0,
    "task2TimeSec" FLOAT DEFAULT 25.0,
    "task3TimeSec" FLOAT DEFAULT 30.0,
    "task4TimeSec" FLOAT DEFAULT 20.0,
    "task5TimeSec" FLOAT DEFAULT 35.0,
    "q1" INTEGER NOT NULL,
    "q2" INTEGER NOT NULL,
    "q3" INTEGER NOT NULL,
    "q4" INTEGER NOT NULL,
    "q5" INTEGER NOT NULL,
    "q6" INTEGER NOT NULL,
    "q7" INTEGER NOT NULL,
    "q8" INTEGER NOT NULL,
    "q9" INTEGER NOT NULL,
    "q10" INTEGER NOT NULL,
    "susScore" FLOAT NOT NULL,
    "comments" TEXT,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- 8. Create the Routine Anchors Table (Smart Routine Anomaly Detection)
CREATE TABLE IF NOT EXISTS "RoutineAnchors" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "label" VARCHAR(100) NOT NULL DEFAULT 'Unnamed Location',
    "latitude" DECIMAL(10, 8) NOT NULL,
    "longitude" DECIMAL(11, 8) NOT NULL,
    "radiusMeters" FLOAT DEFAULT 150.0 NOT NULL,
    "daysMask" INTEGER DEFAULT 31 NOT NULL,
    "expectedArrivalMinute" INTEGER DEFAULT 480 NOT NULL,
    "expectedDepartureMinute" INTEGER DEFAULT 900 NOT NULL,
    "toleranceMinutes" INTEGER DEFAULT 30 NOT NULL,
    "observationCount" INTEGER DEFAULT 1 NOT NULL,
    "isConfirmed" BOOLEAN DEFAULT false NOT NULL,
    "isActive" BOOLEAN DEFAULT true NOT NULL,
    "source" VARCHAR(20) DEFAULT 'LEARNED' NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS routine_anchors_user_active_idx ON "RoutineAnchors" ("userId", "isActive");

-- 9. Create the Routine Deviations Table (Smart Routine Anomaly Detection)
CREATE TABLE IF NOT EXISTS "RoutineDeviations" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "anchorId" UUID REFERENCES "RoutineAnchors" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "deviationType" VARCHAR(30) NOT NULL,
    "actualLatitude" DECIMAL(10, 8),
    "actualLongitude" DECIMAL(11, 8),
    "distanceFromAnchorMeters" FLOAT,
    "description" TEXT,
    "severity" VARCHAR(10) DEFAULT 'MEDIUM' NOT NULL,
    "isAcknowledged" BOOLEAN DEFAULT false NOT NULL,
    "notificationSent" BOOLEAN DEFAULT false NOT NULL,
    "detectedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS routine_deviations_user_detected_idx ON "RoutineDeviations" ("userId", "detectedAt");
CREATE INDEX IF NOT EXISTS routine_deviations_acknowledged_idx ON "RoutineDeviations" ("userId", "isAcknowledged");

-- 10. Create the Safety Check-ins Table (Dead Man's Switch / Safety Escort Timers)
CREATE TABLE IF NOT EXISTS "SafetyCheckins" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "title" VARCHAR(100) DEFAULT 'Safety Escort' NOT NULL,
    "destination" VARCHAR(255),
    "destLatitude" DECIMAL(10, 8),
    "destLongitude" DECIMAL(11, 8),
    "startLatitude" DECIMAL(10, 8),
    "startLongitude" DECIMAL(11, 8),
    "durationMinutes" INTEGER NOT NULL DEFAULT 15,
    "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "status" VARCHAR(20) DEFAULT 'ACTIVE' NOT NULL, -- ACTIVE, COMPLETED, EXPIRED, DURESS_TRIGGERED, CANCELLED
    "notes" TEXT,
    "escrowPayload" JSONB,
    "duressTriggered" BOOLEAN DEFAULT false NOT NULL,
    "alertId" UUID REFERENCES "Alerts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    "completedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS safety_checkins_user_status_idx ON "SafetyCheckins" ("userId", "status");
CREATE INDEX IF NOT EXISTS safety_checkins_expires_status_idx ON "SafetyCheckins" ("expiresAt", "status");
