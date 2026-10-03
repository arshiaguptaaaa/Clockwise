-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "checkIn" TIMESTAMP(3),
ADD COLUMN     "checkOut" TIMESTAMP(3),
ADD COLUMN     "detailsJson" TEXT;

-- CreateTable
CREATE TABLE "SavedPlace" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'STAY',
    "provider" TEXT NOT NULL,
    "providerPlaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "retrievedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedPlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SavedPlace_tripId_userId_idx" ON "SavedPlace"("tripId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedPlace_tripId_userId_provider_providerPlaceId_key" ON "SavedPlace"("tripId", "userId", "provider", "providerPlaceId");

