-- Backfill the existing LigueLead dispatch items so the first interaction-history
-- release does not hide calls and SMS sent before this table existed.
INSERT INTO "ContractInteraction" (
  "id", "accountId", "walletId", "contractId", "channel", "status", "provider",
  "externalId", "contact", "summary", "conversation", "recordingUrl", "payload",
  "occurredAt", "createdAt", "updatedAt"
)
SELECT
  md5('liguelead-dispatch-item:' || item."id"),
  dispatch."accountId",
  dispatch."walletId",
  item."contractId",
  CASE WHEN dispatch."type" = 'AI_CALL' THEN 'AI_VOICE_CALL'::"InteractionChannel" ELSE 'SMS'::"InteractionChannel" END,
  CASE item."status"
    WHEN 'PENDING' THEN 'QUEUED'::"InteractionStatus"
    WHEN 'IN_PROGRESS' THEN 'SENT'::"InteractionStatus"
    WHEN 'COMPLETED' THEN 'ANSWERED'::"InteractionStatus"
    WHEN 'FAILED' THEN 'FAILED'::"InteractionStatus"
    ELSE 'QUEUED'::"InteractionStatus"
  END,
  'LIGUELEAD',
  item."externalCampaignId",
  item."phone",
  CASE
    WHEN dispatch."type" = 'AI_CALL' AND item."status" = 'COMPLETED' THEN 'Ligação com IA atendida'
    WHEN dispatch."type" = 'AI_CALL' AND item."status" = 'FAILED' THEN 'Ligação com IA não atendida ou com falha'
    WHEN dispatch."type" = 'AI_CALL' THEN 'Ligação com IA enviada para processamento'
    WHEN item."status" = 'FAILED' THEN 'SMS com falha'
    ELSE 'SMS enviado para processamento'
  END,
  item."transcript",
  item."recordingUrl",
  item."rawPayload",
  COALESCE(item."completedAt", item."startedAt", item."createdAt"),
  item."createdAt",
  item."updatedAt"
FROM "LigueLeadDispatchItem" item
INNER JOIN "LigueLeadDispatch" dispatch ON dispatch."id" = item."dispatchId"
WHERE NOT EXISTS (
  SELECT 1
  FROM "ContractInteraction" interaction
  WHERE interaction."provider" = 'LIGUELEAD'
    AND interaction."contractId" = item."contractId"
    AND interaction."channel" = CASE WHEN dispatch."type" = 'AI_CALL' THEN 'AI_VOICE_CALL'::"InteractionChannel" ELSE 'SMS'::"InteractionChannel" END
    AND interaction."externalId" IS NOT DISTINCT FROM item."externalCampaignId"
);
