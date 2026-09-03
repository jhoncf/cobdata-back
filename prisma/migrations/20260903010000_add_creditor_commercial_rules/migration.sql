CREATE TABLE "CreditorDiscountBand" (
  "id" TEXT NOT NULL,
  "creditorId" TEXT NOT NULL,
  "minAgingDays" INTEGER NOT NULL,
  "maxAgingDays" INTEGER,
  "cashDiscountPercent" DECIMAL(5,2) NOT NULL,
  "installmentDiscountPercent" DECIMAL(5,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditorDiscountBand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditorDiscountBand_creditorId_fkey" FOREIGN KEY ("creditorId") REFERENCES "Creditor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CreditorCommissionBand" (
  "id" TEXT NOT NULL,
  "creditorId" TEXT NOT NULL,
  "minAgingDays" INTEGER NOT NULL,
  "maxAgingDays" INTEGER,
  "commissionPercent" DECIMAL(5,2) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CreditorCommissionBand_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CreditorCommissionBand_creditorId_fkey" FOREIGN KEY ("creditorId") REFERENCES "Creditor"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "CreditorDiscountBand_creditorId_minAgingDays_idx" ON "CreditorDiscountBand"("creditorId", "minAgingDays");
CREATE INDEX "CreditorCommissionBand_creditorId_minAgingDays_idx" ON "CreditorCommissionBand"("creditorId", "minAgingDays");

ALTER TABLE "Contract"
  ADD COLUMN "maximumDiscountPercent" DECIMAL(5,2),
  ADD COLUMN "repasseValue" DECIMAL(15,2),
  ADD COLUMN "commissionPercent" DECIMAL(5,2),
  ADD COLUMN "commissionValue" DECIMAL(15,2);
