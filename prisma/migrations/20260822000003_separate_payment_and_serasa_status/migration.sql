CREATE TYPE "PaymentStatus" AS ENUM ('OPEN', 'IN_AGREEMENT', 'AGREEMENT_BREACHED', 'PAID');

ALTER TABLE "Contract"
  ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'OPEN';

UPDATE "Contract"
SET "paymentStatus" = CASE "providerStatus"::text
  WHEN 'IN_AGREEMENT' THEN 'IN_AGREEMENT'::"PaymentStatus"
  WHEN 'AGREEMENT_BREACHED' THEN 'AGREEMENT_BREACHED'::"PaymentStatus"
  WHEN 'PAID' THEN 'PAID'::"PaymentStatus"
  ELSE 'OPEN'::"PaymentStatus"
END;

CREATE TYPE "SerasaStatus_new" AS ENUM ('NOT_ENABLED', 'PENDING', 'SENT', 'REGISTERED', 'UPDATED', 'FAILED', 'REMOVING', 'REMOVED');

ALTER TABLE "Contract"
  ALTER COLUMN "providerStatus" DROP DEFAULT,
  ALTER COLUMN "providerStatus" TYPE TEXT USING "providerStatus"::text;

UPDATE "Contract" c
SET "providerStatus" = CASE
  WHEN c."providerStatus" IN ('SENT', 'REGISTERED', 'UPDATED', 'FAILED', 'REMOVING', 'REMOVED') THEN c."providerStatus"
  WHEN c."providerStatus" = 'PENDING' AND EXISTS (
    SELECT 1 FROM "WalletMapping" wm
    JOIN "Provider" p ON p.id = wm."providerId"
    WHERE wm."walletId" = c."walletId" AND p.type = 'SERASA_LNOP'
  ) THEN 'PENDING'
  WHEN c."providerStatus" IN ('IN_AGREEMENT', 'AGREEMENT_BREACHED', 'PAID') THEN 'REGISTERED'
  ELSE 'NOT_ENABLED'
END;

ALTER TABLE "Contract"
  ALTER COLUMN "providerStatus" TYPE "SerasaStatus_new" USING "providerStatus"::"SerasaStatus_new",
  RENAME COLUMN "providerStatus" TO "serasaStatus";

ALTER TABLE "Contract"
  ALTER COLUMN "serasaStatus" SET DEFAULT 'NOT_ENABLED';

DROP TYPE "ProviderStatus";
ALTER TYPE "SerasaStatus_new" RENAME TO "SerasaStatus";

ALTER INDEX "Contract_walletId_providerStatus_idx" RENAME TO "Contract_walletId_serasaStatus_idx";
CREATE INDEX "Contract_walletId_paymentStatus_idx" ON "Contract"("walletId", "paymentStatus");
