-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "formattedAddress" TEXT;
ALTER TABLE "Booking" ADD COLUMN "latitude" REAL;
ALTER TABLE "Booking" ADD COLUMN "longitude" REAL;
ALTER TABLE "Booking" ADD COLUMN "placeName" TEXT;
ALTER TABLE "Booking" ADD COLUMN "providerPlaceId" TEXT;

-- CreateTable
CREATE TABLE "EscalationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "travellerId" TEXT NOT NULL,
    "expectedActionAt" DATETIME NOT NULL,
    "hardThresholdAt" DATETIME,
    "reminderSentAt" DATETIME,
    "acknowledgedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL DEFAULT 'DEMO',
    "provider" TEXT,
    "providerConversationId" TEXT,
    "callStatus" TEXT,
    "callTranscript" TEXT,
    "callDisposition" TEXT,
    "estimatedDelayMinutes" INTEGER,
    "failureReason" TEXT,
    "triggeredAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EscalationEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EscalationEvent_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EscalationEvent_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "voiceEscalationOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "phone") SELECT "createdAt", "email", "id", "name", "phone" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
