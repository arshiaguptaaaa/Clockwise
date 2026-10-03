-- CreateTable
CREATE TABLE "RailCall" (
    "id" TEXT NOT NULL,
    "tripId" TEXT,
    "userId" TEXT,
    "partner" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "responseJson" TEXT,
    "httpStatus" INTEGER,
    "providerRequestId" TEXT,
    "durationMs" INTEGER,
    "relatedKind" TEXT,
    "relatedId" TEXT,
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RailCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RailCall_tripId_createdAt_idx" ON "RailCall"("tripId", "createdAt");

