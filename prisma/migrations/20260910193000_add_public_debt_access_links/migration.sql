CREATE TABLE "PublicDebtAccessLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "interactionId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "openedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicDebtAccessLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PublicDebtAccessLink_token_key" ON "PublicDebtAccessLink"("token");
CREATE UNIQUE INDEX "PublicDebtAccessLink_interactionId_key" ON "PublicDebtAccessLink"("interactionId");
CREATE INDEX "PublicDebtAccessLink_contractId_expiresAt_idx" ON "PublicDebtAccessLink"("contractId", "expiresAt");
CREATE INDEX "PublicDebtAccessLink_expiresAt_idx" ON "PublicDebtAccessLink"("expiresAt");

ALTER TABLE "PublicDebtAccessLink"
  ADD CONSTRAINT "PublicDebtAccessLink_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicDebtAccessLink"
  ADD CONSTRAINT "PublicDebtAccessLink_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicDebtAccessLink"
  ADD CONSTRAINT "PublicDebtAccessLink_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicDebtAccessLink"
  ADD CONSTRAINT "PublicDebtAccessLink_interactionId_fkey"
  FOREIGN KEY ("interactionId") REFERENCES "ContractInteraction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
