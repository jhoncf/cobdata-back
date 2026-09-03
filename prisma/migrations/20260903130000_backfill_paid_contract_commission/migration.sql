-- Backfill historical paid contracts created before commercial snapshots were
-- persisted. The creditor policy is the source of truth for the ceiling and
-- the fixed CobCom commission over the creditor repasse.
WITH priced AS (
  SELECT
    contract.id,
    creditor."commissionPercent" AS commission_percent,
    COALESCE(
      contract."maximumDiscountPercent",
      (
        SELECT CASE WHEN wallet."offerMaxInstallments" > 1
          THEN band."installmentDiscountPercent"
          ELSE band."cashDiscountPercent"
        END
        FROM "CreditorDiscountBand" band
        WHERE band."creditorId" = wallet."creditorId"
          AND band."minAgingDays" <= contract."agingDays"
          AND (band."maxAgingDays" IS NULL OR band."maxAgingDays" >= contract."agingDays")
        ORDER BY band."minAgingDays" DESC
        LIMIT 1
      ),
      0
    ) AS maximum_discount
  FROM "Contract" contract
  JOIN "Wallet" wallet ON wallet.id = contract."walletId"
  JOIN "Creditor" creditor ON creditor.id = wallet."creditorId"
  WHERE contract."deletedAt" IS NULL
    AND contract."paymentStatus" = 'PAID'
    AND (
      contract."maximumDiscountPercent" IS NULL
      OR contract."repasseValue" IS NULL
      OR contract."commissionPercent" IS NULL
      OR contract."commissionValue" IS NULL
      OR (contract."commissionPercent" = 0 AND creditor."commissionPercent" > 0)
    )
)
UPDATE "Contract" contract
SET
  "maximumDiscountPercent" = priced.maximum_discount,
  "repasseValue" = COALESCE(
    contract."repasseValue",
    ROUND(contract."updatedValue" * (1 - priced.maximum_discount / 100), 2)
  ),
  "commissionPercent" = priced.commission_percent,
  "commissionValue" = ROUND(
    COALESCE(
      contract."repasseValue",
      ROUND(contract."updatedValue" * (1 - priced.maximum_discount / 100), 2)
    ) * priced.commission_percent / 100,
    2
  )
FROM priced
WHERE contract.id = priced.id;
