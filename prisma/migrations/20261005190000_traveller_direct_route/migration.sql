-- Additive only. A traveller who says "I'll join you directly at dinner" is routed straight to that commitment's
-- venue instead of via the stay. Nothing existing changes; the columns are null until it is said.
ALTER TABLE "TravellerJourney" ADD COLUMN "directToCommitmentId" TEXT,
ADD COLUMN "directRouteSeconds" INTEGER,
ADD COLUMN "directRouteMeters" INTEGER,
ADD COLUMN "directProvider" TEXT,
ADD COLUMN "notOutBeforeLocal" TEXT;
