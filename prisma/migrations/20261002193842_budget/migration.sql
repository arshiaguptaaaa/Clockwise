-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "stage" TEXT NOT NULL DEFAULT 'PAID',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "paidByUserId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceReferenceId" TEXT,
    "splitMethod" TEXT NOT NULL DEFAULT 'EQUAL',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "proposalMessageId" TEXT,
    "note" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseParticipant" (
    "id" TEXT NOT NULL,
    "expenseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shareMinor" INTEGER NOT NULL,
    "inputValue" DOUBLE PRECISION,

    CONSTRAINT "ExpenseParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "settledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Settlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripBudget" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "totalMinor" INTEGER,
    "categoryJson" TEXT NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripBudget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Expense_idempotencyKey_key" ON "Expense"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Expense_tripId_stage_status_idx" ON "Expense"("tripId", "stage", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseParticipant_expenseId_userId_key" ON "ExpenseParticipant"("expenseId", "userId");

-- CreateIndex
CREATE INDEX "Settlement_tripId_idx" ON "Settlement"("tripId");

-- CreateIndex
CREATE UNIQUE INDEX "TripBudget_tripId_key" ON "TripBudget"("tripId");

-- AddForeignKey
ALTER TABLE "ExpenseParticipant" ADD CONSTRAINT "ExpenseParticipant_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

