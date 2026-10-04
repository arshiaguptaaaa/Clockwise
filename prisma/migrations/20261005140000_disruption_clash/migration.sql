-- Additive only. A journey remembers the arrival printed on the ticket separately from the expected arrival, and a
-- clash records the facts behind "Ridhima won't make dinner" (landing, allowance, provider route, ready time) and
-- where the conversation about it stands.
ALTER TABLE "TravellerJourney" ADD COLUMN "scheduledArriveLocal" TEXT;

CREATE TABLE "TripClash" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "travellerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "commitmentName" TEXT NOT NULL,
    "targetLocal" TEXT NOT NULL,
    "landsAt" TEXT NOT NULL,
    "allowanceMin" INTEGER NOT NULL,
    "routeMinutes" INTEGER NOT NULL,
    "routeProvider" TEXT,
    "anchorKind" TEXT NOT NULL,
    "anchorLabel" TEXT NOT NULL,
    "readyAt" TEXT NOT NULL,
    "suggestedLocal" TEXT,
    "options" TEXT NOT NULL DEFAULT '[]',
    "affectedIds" TEXT NOT NULL DEFAULT '[]',
    "messageId" TEXT,
    "proposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripClash_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TripClash_tripId_status_idx" ON "TripClash"("tripId", "status");
