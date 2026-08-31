ALTER TABLE "ApiKey" ADD COLUMN "creditorId" TEXT;

ALTER TABLE "ApiKey"
ADD CONSTRAINT "ApiKey_creditorId_fkey"
FOREIGN KEY ("creditorId") REFERENCES "Creditor"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "ApiKey_creditorId_revokedAt_idx" ON "ApiKey"("creditorId", "revokedAt");
