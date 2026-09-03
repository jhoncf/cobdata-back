ALTER TABLE "Wallet"
  ADD COLUMN "offerFirstInstallmentDays" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "offerMinInstallmentValue" DECIMAL(15,2) NOT NULL DEFAULT 0.01,
  ADD COLUMN "offerMaxInstallments" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Contract"
  ADD COLUMN "offerValue" DECIMAL(15,2),
  ADD COLUMN "offerFirstInstallmentDays" INTEGER,
  ADD COLUMN "offerMaxInstallments" INTEGER;

CREATE INDEX "Contract_walletId_offerValue_idx" ON "Contract"("walletId", "offerValue");
