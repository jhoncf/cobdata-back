-- AlterTable: Make debtorName non-nullable with default (column already exists from previous migration)
ALTER TABLE "Contract" ALTER COLUMN "debtorName" SET DEFAULT '';
UPDATE "Contract" SET "debtorName" = '' WHERE "debtorName" IS NULL;
ALTER TABLE "Contract" ALTER COLUMN "debtorName" SET NOT NULL;

-- AlterTable: Add new fields
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "dueDate" TIMESTAMP(3);
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "productName" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "debtorStreet" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "debtorCity" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "debtorPhone" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "debtorEmail" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "isNegativated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3);
