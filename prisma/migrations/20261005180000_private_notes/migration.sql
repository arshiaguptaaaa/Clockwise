-- Additive only. A private note is something one traveller asked Clockwise to pass to another traveller (or to
-- remember for themselves). It is never copied into the group chat unless the sender addressed everyone.
CREATE TABLE "PrivateNote" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT,
    "visibility" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'NOTE',
    "body" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "amountMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subject" TEXT,
    "expenseId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PrivateNote_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrivateNote_tripId_recipientId_status_idx" ON "PrivateNote"("tripId", "recipientId", "status");
CREATE INDEX "PrivateNote_tripId_senderId_idx" ON "PrivateNote"("tripId", "senderId");
