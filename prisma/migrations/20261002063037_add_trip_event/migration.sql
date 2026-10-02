-- CreateTable
CREATE TABLE "TripEvent" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "actorUserId" TEXT,
    "subjectUserId" TEXT,
    "sourceChannel" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "confidence" TEXT,
    "payload" TEXT NOT NULL,
    "propagation" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripEvent_tripId_createdAt_idx" ON "TripEvent"("tripId", "createdAt");

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

