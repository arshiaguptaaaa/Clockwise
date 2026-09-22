-- CreateTable
CREATE TABLE "MobilityConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT,
    "providerName" TEXT,
    "providerEmail" TEXT,
    "scope" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" DATETIME,
    CONSTRAINT "MobilityConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransportPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "commitmentId" TEXT,
    "createdBy" TEXT NOT NULL,
    "requesterConnectionId" TEXT,
    "pickup" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TransportPlan_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransportPlan_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RideOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transportPlanId" TEXT NOT NULL,
    "bookingId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'uber',
    "providerRideId" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTING',
    "fareEstimateLow" INTEGER,
    "fareEstimateHigh" INTEGER,
    "fareAmount" INTEGER,
    "currency" TEXT,
    "pickupEtaMinutes" INTEGER,
    "surgeMultiplier" REAL,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RideOrder_transportPlanId_fkey" FOREIGN KEY ("transportPlanId") REFERENCES "TransportPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RideOrder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TransportParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transportPlanId" TEXT NOT NULL,
    "tripMemberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rideOrderId" TEXT,
    CONSTRAINT "TransportParticipant_transportPlanId_fkey" FOREIGN KEY ("transportPlanId") REFERENCES "TransportPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransportParticipant_tripMemberId_fkey" FOREIGN KEY ("tripMemberId") REFERENCES "TripMember" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TransportParticipant_rideOrderId_fkey" FOREIGN KEY ("rideOrderId") REFERENCES "RideOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Journey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "rideOrderId" TEXT,
    CONSTRAINT "Journey_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Journey_rideOrderId_fkey" FOREIGN KEY ("rideOrderId") REFERENCES "RideOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Journey" ("destination", "id", "name", "origin", "startTime", "status", "tripId") SELECT "destination", "id", "name", "origin", "startTime", "status", "tripId" FROM "Journey";
DROP TABLE "Journey";
ALTER TABLE "new_Journey" RENAME TO "Journey";
CREATE UNIQUE INDEX "Journey_rideOrderId_key" ON "Journey"("rideOrderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MobilityConnection_userId_provider_key" ON "MobilityConnection"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "RideOrder_bookingId_key" ON "RideOrder"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "RideOrder_idempotencyKey_key" ON "RideOrder"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TransportParticipant_transportPlanId_tripMemberId_key" ON "TransportParticipant"("transportPlanId", "tripMemberId");
