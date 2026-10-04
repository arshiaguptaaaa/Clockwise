-- Additive only.
-- ProposalApproval.note: the traveller's optional reason when they can't make a proposal.
-- It is the traveller's own words and is never rendered to the group (see decline flow).
ALTER TABLE "ProposalApproval" ADD COLUMN "note" TEXT;

-- Trip.joinCode: a persistent, shareable group join link. Nullable and generated lazily.
ALTER TABLE "Trip" ADD COLUMN "joinCode" TEXT;
CREATE UNIQUE INDEX "Trip_joinCode_key" ON "Trip"("joinCode");
