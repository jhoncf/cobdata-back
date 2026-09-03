ALTER TABLE "WalletDiscountBand" ADD COLUMN "cashStrategyDiscountPercent" DECIMAL(5,2);
ALTER TABLE "WalletDiscountBand" ADD COLUMN "installmentStrategyDiscountPercent" DECIMAL(5,2);
UPDATE "WalletDiscountBand" band SET "cashStrategyDiscountPercent" = LEAST(band."cashDiscountPercent", wallet."cobcomDiscountPercent"), "installmentStrategyDiscountPercent" = LEAST(band."installmentDiscountPercent", wallet."cobcomDiscountPercent") FROM "Wallet" wallet WHERE wallet.id = band."walletId";
