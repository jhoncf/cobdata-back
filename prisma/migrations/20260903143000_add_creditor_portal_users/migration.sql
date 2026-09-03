ALTER TABLE "User" ADD COLUMN "creditorId" TEXT;
ALTER TABLE "User" ADD CONSTRAINT "User_creditorId_fkey"
  FOREIGN KEY ("creditorId") REFERENCES "Creditor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "User_creditorId_idx" ON "User"("creditorId");
