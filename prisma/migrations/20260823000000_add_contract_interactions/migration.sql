-- CreateEnum
CREATE TYPE "InteractionChannel" AS ENUM ('AI_VOICE_CALL', 'SMS', 'WHATSAPP', 'EMAIL');

-- CreateEnum
CREATE TYPE "InteractionStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'ANSWERED', 'COMPLETED', 'FAILED', 'NO_ANSWER', 'REJECTED');

-- CreateTable
CREATE TABLE "ContractInteraction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "channel" "InteractionChannel" NOT NULL,
    "status" "InteractionStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "externalId" TEXT,
    "contact" TEXT,
    "summary" TEXT,
    "conversation" JSONB,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContractInteraction_contractId_occurredAt_idx" ON "ContractInteraction"("contractId", "occurredAt");
CREATE INDEX "ContractInteraction_walletId_channel_status_idx" ON "ContractInteraction"("walletId", "channel", "status");
CREATE INDEX "ContractInteraction_provider_externalId_idx" ON "ContractInteraction"("provider", "externalId");

-- AddForeignKey
ALTER TABLE "ContractInteraction" ADD CONSTRAINT "ContractInteraction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractInteraction" ADD CONSTRAINT "ContractInteraction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContractInteraction" ADD CONSTRAINT "ContractInteraction_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
