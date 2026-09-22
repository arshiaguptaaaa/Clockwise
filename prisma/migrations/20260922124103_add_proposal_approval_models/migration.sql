-- CreateEnum
CREATE TYPE "ProposalType" AS ENUM ('UBER_RIDE', 'ITINERARY_CHANGE', 'BOOKING', 'DOCUMENT_UPDATE', 'OTHER');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PROPOSED', 'AWAITING_APPROVAL', 'APPROVED', 'REJECTED', 'CONFIRMED', 'EXECUTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "type" "ProposalType" NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'AWAITING_APPROVAL',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "groupMessageId" TEXT,
    "supersedesId" TEXT,
    "organiserConfirmedBy" TEXT,
    "organiserConfirmedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "executionResult" TEXT,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalApproval" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "tripMemberId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalReminder" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "tripMemberId" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 1,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_groupMessageId_key" ON "Proposal"("groupMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_supersedesId_key" ON "Proposal"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalApproval_proposalId_tripMemberId_key" ON "ProposalApproval"("proposalId", "tripMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalReminder_proposalId_tripMemberId_tier_key" ON "ProposalReminder"("proposalId", "tripMemberId", "tier");

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_groupMessageId_fkey" FOREIGN KEY ("groupMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalApproval" ADD CONSTRAINT "ProposalApproval_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalApproval" ADD CONSTRAINT "ProposalApproval_tripMemberId_fkey" FOREIGN KEY ("tripMemberId") REFERENCES "TripMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalReminder" ADD CONSTRAINT "ProposalReminder_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalReminder" ADD CONSTRAINT "ProposalReminder_tripMemberId_fkey" FOREIGN KEY ("tripMemberId") REFERENCES "TripMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

