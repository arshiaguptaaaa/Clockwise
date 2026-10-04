-- Additive only. Soft-cancel for plan items, an IDEA card type, and the two tables behind passive trip
-- intelligence: pointers (what Clockwise picked up) and suggestions (what it connected). Neither table is
-- the Plan; a suggestion only reaches the Plan through the normal proposal + organiser confirmation.
ALTER TYPE "CommitmentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "CardType" ADD VALUE IF NOT EXISTS 'IDEA';

CREATE TABLE "TripPointer" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "supporterIds" TEXT NOT NULL DEFAULT '[]',
    "mentions" INTEGER NOT NULL DEFAULT 1,
    "sourceMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripPointer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TripPointer_tripId_userId_kind_subject_key" ON "TripPointer"("tripId", "userId", "kind", "subject");
CREATE INDEX "TripPointer_tripId_status_idx" ON "TripPointer"("tripId", "status");

CREATE TABLE "TripSuggestion" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "steps" TEXT NOT NULL,
    "windowStart" TEXT,
    "windowEnd" TEXT,
    "pointerIds" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "proposalId" TEXT,
    "messageId" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripSuggestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TripSuggestion_tripId_status_idx" ON "TripSuggestion"("tripId", "status");
