CREATE TYPE "CreditorIntegrationType" AS ENUM ('IXC');

CREATE TABLE "CreditorIntegration" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "creditorId" TEXT NOT NULL,
    "type" "CreditorIntegrationType" NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestSucceeded" BOOLEAN,
    "lastTestMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditorIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditorIntegration_creditorId_type_key" ON "CreditorIntegration"("creditorId", "type");
CREATE INDEX "CreditorIntegration_accountId_type_idx" ON "CreditorIntegration"("accountId", "type");

ALTER TABLE "CreditorIntegration" ADD CONSTRAINT "CreditorIntegration_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CreditorIntegration" ADD CONSTRAINT "CreditorIntegration_creditorId_fkey"
  FOREIGN KEY ("creditorId") REFERENCES "Creditor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
