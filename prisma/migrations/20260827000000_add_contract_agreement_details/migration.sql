-- Agreement projections received from Serasa webhooks. PaymentSettlement remains
-- the financial ledger; these fields make the current agreement filterable.
ALTER TABLE "Contract"
  ADD COLUMN "agreementReference" TEXT,
  ADD COLUMN "agreementTotalAmount" DECIMAL(15,2),
  ADD COLUMN "totalInstallments" INTEGER;

CREATE INDEX "Contract_walletId_totalInstallments_idx"
  ON "Contract"("walletId", "totalInstallments");
