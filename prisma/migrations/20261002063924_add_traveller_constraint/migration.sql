-- CreateTable
CREATE TABLE "TravellerConstraint" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "localTime" TEXT NOT NULL,
    "onDate" TIMESTAMP(3),
    "note" TEXT,
    "visibility" "Visibility" NOT NULL DEFAULT 'AGENT_ONLY',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sourceEventId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TravellerConstraint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TravellerConstraint_tripId_userId_status_idx" ON "TravellerConstraint"("tripId", "userId", "status");

-- AddForeignKey
ALTER TABLE "TravellerConstraint" ADD CONSTRAINT "TravellerConstraint_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TravellerConstraint" ADD CONSTRAINT "TravellerConstraint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

