-- Preserve the payable amount for historical contracts before enforcing it.
UPDATE "Contract"
SET "updatedValue" = "originalValue"
WHERE "updatedValue" IS NULL;

ALTER TABLE "Contract"
ALTER COLUMN "updatedValue" SET NOT NULL;
