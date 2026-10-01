warn The configuration property `package.json#prisma` is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., `prisma.config.ts`).
For more information, see: https://pris.ly/prisma-config

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClaimType" ADD VALUE 'SOFT_CONSTRAINT';
ALTER TYPE "ClaimType" ADD VALUE 'CONFLICT';
ALTER TYPE "ClaimType" ADD VALUE 'PARTICIPATION_CHANGE';
ALTER TYPE "ClaimType" ADD VALUE 'BOOKING_INTENT';

-- AlterTable
ALTER TABLE "Decision" ADD COLUMN     "actorUserId" TEXT,
ADD COLUMN     "affectedUserIds" TEXT NOT NULL DEFAULT '[]';

