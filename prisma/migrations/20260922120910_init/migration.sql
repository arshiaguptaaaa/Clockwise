-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('GROUP', 'PRIVATE', 'AGENT_ONLY');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('GROUP', 'PRIVATE');

-- CreateEnum
CREATE TYPE "ClaimType" AS ENUM ('TENTATIVE', 'PREFERENCE', 'HARD_CONSTRAINT', 'DECISION');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('CANDIDATE', 'UNRESOLVED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('ON_TRACK', 'AT_RISK', 'MISSED', 'RECOVERING');

-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('TRANSPORT', 'PAYMENT', 'BOOKING', 'REMINDER', 'ETA_CHANGE', 'DOCUMENT', 'DECISION', 'RECOVERY', 'PLACES', 'ROUTE', 'WEATHER');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED', 'EXPIRED');

-- CreateTable
CREATE TABLE "AgentLock" (
    "key" TEXT NOT NULL,
    "lockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentLock_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "voiceEscalationOptIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "coreStartDate" TIMESTAMP(3),
    "coreEndDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PLANNING',
    "createdBy" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Destination" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "placeId" TEXT,
    "provider" TEXT,
    "order" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),

    CONSTRAINT "Destination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripMember" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "participationStart" TIMESTAMP(3),
    "participationEnd" TIMESTAMP(3),
    "departureCity" TEXT,
    "role" TEXT NOT NULL DEFAULT 'TRAVELLER',

    CONSTRAINT "TripMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invite" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "inviteeName" TEXT NOT NULL,
    "contact" TEXT,
    "invitedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateProfile" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetCeiling" INTEGER,
    "budgetVisibility" "Visibility" NOT NULL DEFAULT 'AGENT_ONLY',
    "hardCommitments" TEXT,
    "roomPreference" TEXT,
    "roomSharingWith" TEXT,
    "seatPreference" TEXT,
    "accessibilityNeeds" TEXT,
    "passportStatus" TEXT,
    "visaStatus" TEXT,
    "paymentPreference" TEXT,

    CONSTRAINT "PrivateProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionType" TEXT NOT NULL,
    "visibility" "Visibility" NOT NULL,
    "purpose" TEXT,
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipientId" TEXT,
    "cardType" "CardType",
    "cardData" TEXT,
    "cardStatus" "CardStatus",
    "toolCalls" TEXT,
    "failed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "type" "ClaimType" NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "status" "DecisionStatus" NOT NULL DEFAULT 'CANDIDATE',
    "sourceMessageIds" TEXT NOT NULL,
    "confirmedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Commitment" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetTime" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "participantIds" TEXT NOT NULL,
    "hardThreshold" TIMESTAMP(3),
    "nextCheckpoint" TEXT,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'ON_TRACK',

    CONSTRAINT "Commitment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "participantIds" TEXT NOT NULL,
    "payerId" TEXT,
    "amount" INTEGER,
    "currency" TEXT,
    "provider" TEXT NOT NULL,
    "confirmationId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "placeName" TEXT,
    "formattedAddress" TEXT,
    "city" TEXT,
    "region" TEXT,
    "country" TEXT,
    "countryCode" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "providerPlaceId" TEXT,
    "locationProvider" TEXT,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "rideOrderId" TEXT,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyParticipant" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "locationVisibility" "Visibility" NOT NULL DEFAULT 'AGENT_ONLY',
    "currentMockLocation" TEXT,
    "eta" TIMESTAMP(3),
    "readinessStatus" "CommitmentStatus" NOT NULL DEFAULT 'ON_TRACK',

    CONSTRAINT "JourneyParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "payloadSummary" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistSignup" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaitlistSignup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageView" (
    "id" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "referrer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalReachMetric" (
    "id" TEXT NOT NULL,
    "instagramReach" INTEGER,
    "instagramImpressions" INTEGER,
    "linkedinImpressions" INTEGER,
    "communityReach" INTEGER,
    "adSpend" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalReachMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MobilityConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerUserId" TEXT,
    "providerName" TEXT,
    "providerEmail" TEXT,
    "scope" TEXT NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "MobilityConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportPlan" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "commitmentId" TEXT,
    "createdBy" TEXT NOT NULL,
    "requesterConnectionId" TEXT,
    "pickup" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "partySize" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransportPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RideOrder" (
    "id" TEXT NOT NULL,
    "transportPlanId" TEXT NOT NULL,
    "bookingId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'uber',
    "providerRideId" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTING',
    "fareEstimateLow" DOUBLE PRECISION,
    "fareEstimateHigh" DOUBLE PRECISION,
    "fareAmount" DOUBLE PRECISION,
    "currency" TEXT,
    "pickupEtaMinutes" INTEGER,
    "surgeMultiplier" DOUBLE PRECISION,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RideOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportParticipant" (
    "id" TEXT NOT NULL,
    "transportPlanId" TEXT NOT NULL,
    "tripMemberId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "rideOrderId" TEXT,

    CONSTRAINT "TransportParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EscalationEvent" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "travellerId" TEXT NOT NULL,
    "expectedActionAt" TIMESTAMP(3) NOT NULL,
    "hardThresholdAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mode" TEXT NOT NULL DEFAULT 'DEMO',
    "provider" TEXT,
    "providerConversationId" TEXT,
    "callStatus" TEXT,
    "callTranscript" TEXT,
    "callDisposition" TEXT,
    "estimatedDelayMinutes" INTEGER,
    "failureReason" TEXT,
    "triggeredAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EscalationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TripMember_tripId_userId_key" ON "TripMember"("tripId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invite_token_key" ON "Invite"("token");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateProfile_tripId_userId_key" ON "PrivateProfile"("tripId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Journey_rideOrderId_key" ON "Journey"("rideOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistSignup_email_key" ON "WaitlistSignup"("email");

-- CreateIndex
CREATE UNIQUE INDEX "MobilityConnection_userId_provider_key" ON "MobilityConnection"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "RideOrder_bookingId_key" ON "RideOrder"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "RideOrder_idempotencyKey_key" ON "RideOrder"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "TransportParticipant_transportPlanId_tripMemberId_key" ON "TransportParticipant"("transportPlanId", "tripMemberId");

-- AddForeignKey
ALTER TABLE "Destination" ADD CONSTRAINT "Destination_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripMember" ADD CONSTRAINT "TripMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invite" ADD CONSTRAINT "Invite_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateProfile" ADD CONSTRAINT "PrivateProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateProfile" ADD CONSTRAINT "PrivateProfile_tripId_userId_fkey" FOREIGN KEY ("tripId", "userId") REFERENCES "TripMember"("tripId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Decision" ADD CONSTRAINT "Decision_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Commitment" ADD CONSTRAINT "Commitment_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_rideOrderId_fkey" FOREIGN KEY ("rideOrderId") REFERENCES "RideOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyParticipant" ADD CONSTRAINT "JourneyParticipant_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MobilityConnection" ADD CONSTRAINT "MobilityConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportPlan" ADD CONSTRAINT "TransportPlan_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportPlan" ADD CONSTRAINT "TransportPlan_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideOrder" ADD CONSTRAINT "RideOrder_transportPlanId_fkey" FOREIGN KEY ("transportPlanId") REFERENCES "TransportPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RideOrder" ADD CONSTRAINT "RideOrder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportParticipant" ADD CONSTRAINT "TransportParticipant_transportPlanId_fkey" FOREIGN KEY ("transportPlanId") REFERENCES "TransportPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportParticipant" ADD CONSTRAINT "TransportParticipant_tripMemberId_fkey" FOREIGN KEY ("tripMemberId") REFERENCES "TripMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportParticipant" ADD CONSTRAINT "TransportParticipant_rideOrderId_fkey" FOREIGN KEY ("rideOrderId") REFERENCES "RideOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "Commitment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EscalationEvent" ADD CONSTRAINT "EscalationEvent_travellerId_fkey" FOREIGN KEY ("travellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

