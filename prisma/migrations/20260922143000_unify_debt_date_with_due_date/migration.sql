-- "Data de ocorrência" was a legacy conceptual error. The due date is the
-- single debt date. Preserve data when legacy rows have no due date, then
-- make both stored fields match so old API consumers remain consistent.
UPDATE "Contract"
SET
  "dueDate" = COALESCE("dueDate", "occurrenceDate"),
  "occurrenceDate" = COALESCE("dueDate", "occurrenceDate")
WHERE "dueDate" IS NULL
   OR "occurrenceDate" IS DISTINCT FROM "dueDate";
