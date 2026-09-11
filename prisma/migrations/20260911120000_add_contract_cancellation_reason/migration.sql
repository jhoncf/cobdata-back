CREATE TYPE "CancellationReason" AS ENUM ('CREDITOR_REQUEST', 'CONTESTATION');

ALTER TABLE "Contract"
  ADD COLUMN "cancellationReason" "CancellationReason";
