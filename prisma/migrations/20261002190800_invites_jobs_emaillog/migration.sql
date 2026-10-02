-- AlterTable
ALTER TABLE "Invite" ADD COLUMN     "callConsent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSentAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "sendCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "inviteId" TEXT,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "providerRequestId" TEXT,
    "failureReason" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
    "tripId" TEXT,
    "inviteId" TEXT,
    "jobId" TEXT,
    "kind" TEXT NOT NULL,
    "intendedRecipient" TEXT NOT NULL,
    "deliveryRecipient" TEXT NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'resend',
    "providerMessageId" TEXT,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "subject" TEXT NOT NULL,
    "ctaUrl" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledJob_idempotencyKey_key" ON "ScheduledJob"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ScheduledJob_status_scheduledFor_idx" ON "ScheduledJob"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "ScheduledJob_inviteId_idx" ON "ScheduledJob"("inviteId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailLog_idempotencyKey_key" ON "EmailLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "EmailLog_tripId_createdAt_idx" ON "EmailLog"("tripId", "createdAt");

