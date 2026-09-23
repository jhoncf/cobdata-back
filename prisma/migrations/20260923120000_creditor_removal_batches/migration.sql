CREATE TYPE "CreditorRemovalBatchStatus" AS ENUM ('PENDING_VALIDATION', 'VALIDATING', 'READY', 'APPLYING', 'COMPLETED', 'FAILED');

CREATE TABLE "CreditorRemovalBatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "columnMapping" JSONB NOT NULL,
    "contractIds" JSONB,
    "status" "CreditorRemovalBatchStatus" NOT NULL DEFAULT 'PENDING_VALIDATION',
    "totalLines" INTEGER NOT NULL DEFAULT 0,
    "validLines" INTEGER NOT NULL DEFAULT 0,
    "invalidLines" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "blockedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateLines" INTEGER NOT NULL DEFAULT 0,
    "cancelledCount" INTEGER NOT NULL DEFAULT 0,
    "queuedForSerasaRemoval" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreditorRemovalBatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CreditorRemovalBatch_accountId_creditorId_createdAt_idx" ON "CreditorRemovalBatch"("accountId", "creditorId", "createdAt");
