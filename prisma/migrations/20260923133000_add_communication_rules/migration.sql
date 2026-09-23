CREATE TABLE "CommunicationTemplate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletId" TEXT,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunicationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunicationRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "schedule" JSONB NOT NULL,
    "conditions" JSONB NOT NULL,
    "channel" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunicationRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunicationRuleRun" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommunicationRuleRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunicationTemplate_accountId_walletId_channel_idx" ON "CommunicationTemplate"("accountId", "walletId", "channel");
CREATE INDEX "CommunicationRule_accountId_walletId_active_idx" ON "CommunicationRule"("accountId", "walletId", "active");
CREATE UNIQUE INDEX "CommunicationRuleRun_ruleId_scheduledFor_key" ON "CommunicationRuleRun"("ruleId", "scheduledFor");
CREATE INDEX "CommunicationRuleRun_ruleId_scheduledFor_idx" ON "CommunicationRuleRun"("ruleId", "scheduledFor");

ALTER TABLE "CommunicationTemplate" ADD CONSTRAINT "CommunicationTemplate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunicationTemplate" ADD CONSTRAINT "CommunicationTemplate_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationRule" ADD CONSTRAINT "CommunicationRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunicationRule" ADD CONSTRAINT "CommunicationRule_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunicationRule" ADD CONSTRAINT "CommunicationRule_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "CommunicationTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CommunicationRuleRun" ADD CONSTRAINT "CommunicationRuleRun_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "CommunicationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve each wallet's existing SMS copy as a selectable template.
INSERT INTO "CommunicationTemplate" ("id", "accountId", "walletId", "channel", "name", "content", "isDefault", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || "id"::text), "accountId", "id", 'SMS', 'Template SMS atual', "smsTemplate", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Wallet"
WHERE "smsTemplate" IS NOT NULL AND btrim("smsTemplate") <> '';
