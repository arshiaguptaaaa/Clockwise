-- Additive only. A conditional yes ("only if we're back by 11") is kept on the proposal and never counted as approval.
CREATE TABLE "ProposalCondition" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalCondition_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ProposalCondition_proposalId_status_idx" ON "ProposalCondition"("proposalId", "status");
ALTER TABLE "ProposalCondition" ADD CONSTRAINT "ProposalCondition_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
