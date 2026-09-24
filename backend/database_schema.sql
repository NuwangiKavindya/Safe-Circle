-- Connect to the safe_circle database 
-- \c safe_circle

-- 1. Create the User Registration Table
CREATE TABLE IF NOT EXISTS "Users" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "fullName" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255) NOT NULL UNIQUE,
    "phoneNumber" VARCHAR(20) NOT NULL UNIQUE,
    "password" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "alarmSound" VARCHAR(50) DEFAULT 'police_siren',
    "fcmToken"   TEXT,
    "updatedAt"  TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
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

-- 3. Create the Trusted Contacts Table
CREATE TABLE IF NOT EXISTS "TrustedContacts" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL REFERENCES "Users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "contactName" VARCHAR(255) NOT NULL,
    "contactPhone" VARCHAR(20) NOT NULL,
    "contactEmail" VARCHAR(255),
    "relationship" VARCHAR(100),
    "isVerified" BOOLEAN DEFAULT false NOT NULL,
    "accessCode" VARCHAR(20) UNIQUE,
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
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

