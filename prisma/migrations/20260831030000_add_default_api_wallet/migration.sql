ALTER TABLE "Wallet" ADD COLUMN "isApiDefault" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Wallet_one_default_api_wallet_per_creditor" ON "Wallet" ("creditorId") WHERE "isApiDefault" = true AND "deletedAt" IS NULL;
