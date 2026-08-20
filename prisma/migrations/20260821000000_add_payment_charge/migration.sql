-- CreateEnum
CREATE TYPE "PaymentChargeStatus" AS ENUM ('PENDING', 'ISSUED', 'PAID', 'CANCELLED', 'EXPIRED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentChargeChannel" AS ENUM ('COBCOM', 'LANDING_PAGE', 'WHATSAPP', 'CHATBOT');

-- CreateTable
CREATE TABLE "PaymentCharge" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "paymentGatewayId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentChargeStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(15,2) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "externalId" TEXT,
    "externalStatus" TEXT,
    "ourNumber" TEXT,
    "txid" TEXT,
    "digitableLine" TEXT,
    "barcode" TEXT,
    "pixCopyPaste" TEXT,
    "qrCodeUrl" TEXT,
    "documentUrl" TEXT,
    "providerPayload" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "attributedChannel" "PaymentChargeChannel",
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentCharge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentCharge_idempotencyKey_paymentGatewayId_key" ON "PaymentCharge"("idempotencyKey", "paymentGatewayId");

-- CreateIndex
CREATE INDEX "PaymentCharge_contractId_status_idx" ON "PaymentCharge"("contractId", "status");

-- CreateIndex
CREATE INDEX "PaymentCharge_status_expiresAt_idx" ON "PaymentCharge"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "PaymentCharge_status_dueDate_idx" ON "PaymentCharge"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PaymentCharge_txid_idx" ON "PaymentCharge"("txid");

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentCharge" ADD CONSTRAINT "PaymentCharge_paymentGatewayId_fkey" FOREIGN KEY ("paymentGatewayId") REFERENCES "PaymentGateway"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
