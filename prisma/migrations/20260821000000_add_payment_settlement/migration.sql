-- CreateEnum
CREATE TYPE "PaymentSettlementSource" AS ENUM ('PIX', 'SERASA', 'MANUAL');

-- CreateEnum
CREATE TYPE "PaymentSettlementStatus" AS ENUM ('CONFIRMED', 'REVERSED');

-- CreateTable
CREATE TABLE "PaymentSettlement" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "paymentChargeId" TEXT,
    "agreementReference" TEXT,
    "installmentNumber" INTEGER,
    "source" "PaymentSettlementSource" NOT NULL,
    "status" "PaymentSettlementStatus" NOT NULL DEFAULT 'CONFIRMED',
    "amount" DECIMAL(15,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "externalPaymentId" TEXT NOT NULL,
    "channelEventId" TEXT,
    "debtReference" TEXT,
    "metadata" JSONB,
    "providerPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique deduplication index on (source, externalPaymentId)
CREATE UNIQUE INDEX "PaymentSettlement_source_externalPaymentId_key" ON "PaymentSettlement"("source", "externalPaymentId");

-- CreateIndex: index on contractId for queries
CREATE INDEX "PaymentSettlement_contractId_idx" ON "PaymentSettlement"("contractId");

-- Cached projections: the settlement ledger is the source of truth.
ALTER TABLE "Contract" ADD COLUMN "totalPaidAmount" DECIMAL(15,2) NOT NULL DEFAULT 0;
ALTER TABLE "Contract" ADD COLUMN "lastPaymentAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_paymentChargeId_fkey" FOREIGN KEY ("paymentChargeId") REFERENCES "PaymentCharge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
