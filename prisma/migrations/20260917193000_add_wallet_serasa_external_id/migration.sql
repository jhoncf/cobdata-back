-- Per-CRM-wallet target used by the Serasa debt payload.
ALTER TABLE "Wallet" ADD COLUMN "serasaWalletExternalId" TEXT;

-- Preserve the target selected through the former centralized Serasa-wallet
-- screen so existing configurations keep working after this change.
UPDATE "Wallet" AS wallet
SET "serasaWalletExternalId" = serasa_wallet."externalWalletId"
FROM "SerasaWallet" AS serasa_wallet
WHERE wallet."serasaWalletId" = serasa_wallet.id
  AND wallet."serasaWalletExternalId" IS NULL;
