ALTER TABLE "Contract"
ADD COLUMN "agingDays" INTEGER NOT NULL DEFAULT 0;

UPDATE "Contract"
SET "agingDays" = GREATEST(
  0,
  ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date - ("occurrenceDate" AT TIME ZONE 'America/Sao_Paulo')::date)
);

CREATE INDEX "Contract_agingDays_idx" ON "Contract"("agingDays");
