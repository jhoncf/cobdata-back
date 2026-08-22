CREATE TABLE "LigueLeadWalletAgent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "greetings" TEXT,
    "modelVersion" TEXT NOT NULL DEFAULT 'lumen-1',
    "voiceId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LigueLeadWalletAgent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LigueLeadDispatch" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "externalId" TEXT,
    "totalItems" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LigueLeadDispatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LigueLeadWalletAgent_walletId_key" ON "LigueLeadWalletAgent"("walletId");
CREATE UNIQUE INDEX "LigueLeadWalletAgent_externalId_key" ON "LigueLeadWalletAgent"("externalId");
CREATE INDEX "LigueLeadDispatch_walletId_createdAt_idx" ON "LigueLeadDispatch"("walletId", "createdAt");

ALTER TABLE "LigueLeadWalletAgent" ADD CONSTRAINT "LigueLeadWalletAgent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LigueLeadWalletAgent" ADD CONSTRAINT "LigueLeadWalletAgent_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LigueLeadDispatch" ADD CONSTRAINT "LigueLeadDispatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LigueLeadDispatch" ADD CONSTRAINT "LigueLeadDispatch_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LigueLeadDispatch" ADD CONSTRAINT "LigueLeadDispatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
