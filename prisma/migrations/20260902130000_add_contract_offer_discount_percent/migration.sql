ALTER TABLE "Contract"
  ADD COLUMN "offerDiscountPercent" DECIMAL(5,2);

-- Preserve the commercial rule that generated each pre-calculated offer.
UPDATE "Contract" AS contract
SET "offerDiscountPercent" = wallet."cobcomDiscountPercent"
FROM "Wallet" AS wallet
WHERE contract."walletId" = wallet.id
  AND contract."offerValue" IS NOT NULL
  AND contract."offerDiscountPercent" IS NULL;
