-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "city" TEXT;
ALTER TABLE "Booking" ADD COLUMN "country" TEXT;
ALTER TABLE "Booking" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "Booking" ADD COLUMN "locationProvider" TEXT;
ALTER TABLE "Booking" ADD COLUMN "region" TEXT;

-- AlterTable
ALTER TABLE "Destination" ADD COLUMN "city" TEXT;
ALTER TABLE "Destination" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "Destination" ADD COLUMN "provider" TEXT;
ALTER TABLE "Destination" ADD COLUMN "region" TEXT;
