-- CreateTable
CREATE TABLE "TravellerLocation" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consent" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracyMeters" DOUBLE PRECISION,
    "recordedAt" TIMESTAMP(3),
    "consentedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravellerLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravellerReadiness" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "earliestReadyAt" TIMESTAMP(3),
    "latestCommitmentAt" TIMESTAMP(3),
    "travelMinutes" INTEGER,
    "bufferMinutes" INTEGER,
    "manualDelayMinutes" INTEGER NOT NULL DEFAULT 0,
    "signals" TEXT NOT NULL DEFAULT '[]',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravellerReadiness_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TravellerLocation_tripId_userId_key" ON "TravellerLocation"("tripId", "userId");

-- CreateIndex
CREATE INDEX "TravellerReadiness_tripId_idx" ON "TravellerReadiness"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TravellerReadiness_tripId_userId_commitmentId_key" ON "TravellerReadiness"("tripId", "userId", "commitmentId");

