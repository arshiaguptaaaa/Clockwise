-- Additive only. Real Delhivery responses kept so a redeploy or a repeat question does not spend
-- the token's small daily call quota again, plus the shared rate-limit marker (key "__ratelimit__").
CREATE TABLE "DelhiveryCache" (
    "key" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "responseJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DelhiveryCache_pkey" PRIMARY KEY ("key")
);
