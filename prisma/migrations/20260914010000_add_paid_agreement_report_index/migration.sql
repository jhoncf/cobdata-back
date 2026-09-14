CREATE INDEX "Contract_accountId_paymentStatus_lastPaymentAt_idx"
  ON "Contract"("accountId", "paymentStatus", "lastPaymentAt");
