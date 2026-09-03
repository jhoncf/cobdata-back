ALTER TABLE "Contract"
  ADD COLUMN "agreementDueAt" TIMESTAMP(3);

CREATE INDEX "Contract_paymentStatus_agreementDueAt_idx"
  ON "Contract"("paymentStatus", "agreementDueAt");

-- A valid Pix already sent before this change represents an active agreement.
-- Only open contracts with a still-valid issued charge are backfilled.
WITH latest_issued_charge AS (
  SELECT DISTINCT ON ("contractId")
    id,
    "contractId",
    amount,
    "externalId",
    txid,
    "createdAt"
  FROM "PaymentCharge"
  WHERE status = 'ISSUED'
    AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
  ORDER BY "contractId", "createdAt" DESC
)
UPDATE "Contract" AS contract
SET
  "paymentStatus" = 'IN_AGREEMENT',
  "agreementReference" = COALESCE(charge."externalId", charge.txid, charge.id),
  "agreementTotalAmount" = charge.amount,
  "agreedPaymentAmount" = charge.amount,
  "totalInstallments" = 1,
  "paidInstallments" = 0,
  "agreementDueAt" = charge."createdAt" + (COALESCE(wallet."offerFirstInstallmentDays", 5) * INTERVAL '1 day')
FROM latest_issued_charge AS charge,
     "Wallet" AS wallet
WHERE contract.id = charge."contractId"
  AND wallet.id = contract."walletId"
  AND contract."paymentStatus" = 'OPEN'
  AND contract."deletedAt" IS NULL;
