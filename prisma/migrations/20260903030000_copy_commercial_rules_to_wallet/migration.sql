ALTER TABLE "Wallet"
ADD COLUMN "commissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

CREATE TABLE "WalletDiscountBand" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "minAgingDays" INTEGER NOT NULL,
  "maxAgingDays" INTEGER,
  "cashDiscountPercent" DECIMAL(5,2) NOT NULL,
  "installmentDiscountPercent" DECIMAL(5,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WalletDiscountBand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WalletDiscountBand_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "WalletDiscountBand_walletId_minAgingDays_idx" ON "WalletDiscountBand"("walletId", "minAgingDays");

UPDATE "Wallet" wallet
SET "commissionPercent" = creditor."commissionPercent"
FROM "Creditor" creditor
WHERE creditor.id = wallet."creditorId";

INSERT INTO "WalletDiscountBand" (
  "id", "walletId", "minAgingDays", "maxAgingDays", "cashDiscountPercent", "installmentDiscountPercent", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, wallet.id, band."minAgingDays", band."maxAgingDays", band."cashDiscountPercent", band."installmentDiscountPercent", NOW(), NOW()
FROM "Wallet" wallet
JOIN "CreditorDiscountBand" band ON band."creditorId" = wallet."creditorId";
