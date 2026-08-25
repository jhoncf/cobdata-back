CREATE TYPE "ApiKeyScope" AS ENUM ('CONTRACTS_READ', 'CONTRACT_CONTACTS_WRITE', 'PIX_CREATE');

CREATE TABLE "ApiKey" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "tokenPrefix" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "scopes" "ApiKeyScope"[] NOT NULL,
  "lastUsedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiKey_tokenHash_key" ON "ApiKey"("tokenHash");
CREATE INDEX "ApiKey_accountId_revokedAt_idx" ON "ApiKey"("accountId", "revokedAt");
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
