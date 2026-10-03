-- CreateTable
CREATE TABLE "TravellerPreference" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "detailJson" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'PRIVATE',
    "source" TEXT NOT NULL DEFAULT 'VIBE_CHECK',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravellerPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VibeCheck" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VibeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TravellerJourney" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "carrier" TEXT,
    "originName" TEXT,
    "destinationName" TEXT,
    "departLocal" TEXT,
    "arriveLocal" TEXT,
    "arrivalPlaceName" TEXT,
    "arrivalLat" DOUBLE PRECISION,
    "arrivalLng" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "attachmentId" TEXT,
    "routeToStayMeters" INTEGER,
    "routeToStaySeconds" INTEGER,
    "routeProvider" TEXT,
    "routeComputedAt" TIMESTAMP(3),
    "routeStayBookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TravellerJourney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TravellerPreference_tripId_key_value_idx" ON "TravellerPreference"("tripId", "key", "value");

-- CreateIndex
CREATE UNIQUE INDEX "TravellerPreference_tripId_userId_key_value_key" ON "TravellerPreference"("tripId", "userId", "key", "value");

-- CreateIndex
CREATE UNIQUE INDEX "VibeCheck_tripId_userId_key" ON "VibeCheck"("tripId", "userId");

-- CreateIndex
CREATE INDEX "TravellerJourney_tripId_userId_status_idx" ON "TravellerJourney"("tripId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_tripId_userId_key_key" ON "ChecklistItem"("tripId", "userId", "key");

