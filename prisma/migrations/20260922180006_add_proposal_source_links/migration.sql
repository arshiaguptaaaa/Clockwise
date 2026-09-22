-- AlterTable
ALTER TABLE "Destination" ADD COLUMN     "sourceProposalId" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "sourceProposalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Destination_sourceProposalId_key" ON "Destination"("sourceProposalId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_sourceProposalId_key" ON "Booking"("sourceProposalId");

