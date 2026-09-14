CREATE INDEX "ContractInteraction_accountId_occurredAt_idx"
  ON "ContractInteraction"("accountId", "occurredAt");

CREATE INDEX "PaymentSettlement_accountId_paidAt_idx"
  ON "PaymentSettlement"("accountId", "paidAt");
