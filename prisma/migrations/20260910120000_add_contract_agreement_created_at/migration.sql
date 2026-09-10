ALTER TABLE "Contract" ADD COLUMN "agreementCreatedAt" TIMESTAMP(3);

CREATE INDEX "Contract_accountId_agreementCreatedAt_idx"
  ON "Contract"("accountId", "agreementCreatedAt");
