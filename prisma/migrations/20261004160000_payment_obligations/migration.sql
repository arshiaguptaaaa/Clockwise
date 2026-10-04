-- Additive only. A group payment is a COLLECTION with one OBLIGATION per traveller; each obligation
-- gets its own Pine Labs link (created when that person presses PAY), its own merchant reference
-- and its own status. Nobody pays anyone else's share.
CREATE TABLE "PaymentCollection" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "sourceProposalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCollection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentObligation" (
    "id" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DUE',
    "merchantRef" TEXT NOT NULL,
    "bookingId" TEXT,
    "paymentLinkId" TEXT,
    "paymentUrl" TEXT,
    "lastError" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentObligation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentObligation_merchantRef_key" ON "PaymentObligation"("merchantRef");
CREATE UNIQUE INDEX "PaymentObligation_collectionId_userId_key" ON "PaymentObligation"("collectionId", "userId");
CREATE INDEX "PaymentObligation_tripId_userId_idx" ON "PaymentObligation"("tripId", "userId");
CREATE INDEX "PaymentCollection_tripId_idx" ON "PaymentCollection"("tripId");

ALTER TABLE "PaymentObligation" ADD CONSTRAINT "PaymentObligation_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "PaymentCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
