/*
  Warnings:

  - Made the column `debtorName` on table `Contract` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Contract" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "debtorCity" TEXT,
ADD COLUMN     "debtorEmail" TEXT,
ADD COLUMN     "debtorPhone" TEXT,
ADD COLUMN     "debtorStreet" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "isNegativated" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "productName" TEXT,
ALTER COLUMN "debtorName" SET NOT NULL,
ALTER COLUMN "debtorName" SET DEFAULT '';
