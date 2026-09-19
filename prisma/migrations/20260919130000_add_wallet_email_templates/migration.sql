CREATE TABLE "WalletEmailTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "htmlBody" TEXT NOT NULL,
    "textBody" TEXT,
    "criteria" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WalletEmailTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailTrackingLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "interactionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailTrackingLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailTrackingLink_token_key" ON "EmailTrackingLink"("token");
CREATE INDEX "WalletEmailTemplate_walletId_isActive_idx" ON "WalletEmailTemplate"("walletId", "isActive");
CREATE INDEX "WalletEmailTemplate_accountId_walletId_idx" ON "WalletEmailTemplate"("accountId", "walletId");
CREATE INDEX "EmailTrackingLink_interactionId_kind_idx" ON "EmailTrackingLink"("interactionId", "kind");

ALTER TABLE "WalletEmailTemplate" ADD CONSTRAINT "WalletEmailTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WalletEmailTemplate" ADD CONSTRAINT "WalletEmailTemplate_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EmailTrackingLink" ADD CONSTRAINT "EmailTrackingLink_interactionId_fkey" FOREIGN KEY ("interactionId") REFERENCES "ContractInteraction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
