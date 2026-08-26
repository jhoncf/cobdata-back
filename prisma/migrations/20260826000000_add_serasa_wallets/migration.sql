-- CreateTable
CREATE TABLE "SerasaWallet" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalWalletId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SerasaWallet_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN "serasaWalletId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SerasaWallet_accountId_externalWalletId_key" ON "SerasaWallet"("accountId", "externalWalletId");
CREATE INDEX "SerasaWallet_accountId_idx" ON "SerasaWallet"("accountId");
CREATE INDEX "Wallet_serasaWalletId_idx" ON "Wallet"("serasaWalletId");

-- AddForeignKey
ALTER TABLE "SerasaWallet" ADD CONSTRAINT "SerasaWallet_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_serasaWalletId_fkey" FOREIGN KEY ("serasaWalletId") REFERENCES "SerasaWallet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
