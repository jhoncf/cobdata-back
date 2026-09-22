-- Aging represents the time the invoice has been overdue. Legacy records
-- without a due date use their only available debt date as the due date.
UPDATE "Contract"
SET "dueDate" = "occurrenceDate"
WHERE "deletedAt" IS NULL
  AND "dueDate" IS NULL;

UPDATE "Contract"
SET "agingDays" = GREATEST(
  0,
  ((NOW() AT TIME ZONE 'America/Sao_Paulo')::date - ("dueDate" AT TIME ZONE 'America/Sao_Paulo')::date)
)
WHERE "deletedAt" IS NULL;
