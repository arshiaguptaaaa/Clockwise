/*
  Warnings:

  - You are about to alter the column `fareAmount` on the `RideOrder` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.
  - You are about to alter the column `fareEstimateHigh` on the `RideOrder` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.
  - You are about to alter the column `fareEstimateLow` on the `RideOrder` table. The data in that column could be lost. The data in that column will be cast from `Int` to `Float`.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RideOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transportPlanId" TEXT NOT NULL,
    "bookingId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'uber',
    "providerRideId" TEXT,
    "productId" TEXT,
    "productName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTING',
    "fareEstimateLow" REAL,
    "fareEstimateHigh" REAL,
    "fareAmount" REAL,
    "currency" TEXT,
    "pickupEtaMinutes" INTEGER,
    "surgeMultiplier" REAL,
    "errorMessage" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RideOrder_transportPlanId_fkey" FOREIGN KEY ("transportPlanId") REFERENCES "TransportPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "RideOrder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RideOrder" ("bookingId", "createdAt", "currency", "errorMessage", "fareAmount", "fareEstimateHigh", "fareEstimateLow", "id", "idempotencyKey", "pickupEtaMinutes", "productId", "productName", "provider", "providerRideId", "status", "surgeMultiplier", "transportPlanId", "updatedAt") SELECT "bookingId", "createdAt", "currency", "errorMessage", "fareAmount", "fareEstimateHigh", "fareEstimateLow", "id", "idempotencyKey", "pickupEtaMinutes", "productId", "productName", "provider", "providerRideId", "status", "surgeMultiplier", "transportPlanId", "updatedAt" FROM "RideOrder";
DROP TABLE "RideOrder";
ALTER TABLE "new_RideOrder" RENAME TO "RideOrder";
CREATE UNIQUE INDEX "RideOrder_bookingId_key" ON "RideOrder"("bookingId");
CREATE UNIQUE INDEX "RideOrder_idempotencyKey_key" ON "RideOrder"("idempotencyKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
