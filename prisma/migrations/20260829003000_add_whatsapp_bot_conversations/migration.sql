CREATE TYPE "WhatsAppBotState" AS ENUM ('AWAITING_CPF', 'AWAITING_ACTION');

CREATE TABLE "WhatsAppBotConversation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "conversationKey" TEXT NOT NULL,
    "chatwootConversationId" TEXT,
    "debtorDocumentEncrypted" TEXT,
    "contracts" JSONB,
    "state" "WhatsAppBotState" NOT NULL DEFAULT 'AWAITING_CPF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WhatsAppBotConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppBotMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsAppBotMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppBotConversation_conversationKey_key" ON "WhatsAppBotConversation"("conversationKey");
CREATE UNIQUE INDEX "WhatsAppBotConversation_chatwootConversationId_key" ON "WhatsAppBotConversation"("chatwootConversationId");
CREATE INDEX "WhatsAppBotConversation_accountId_updatedAt_idx" ON "WhatsAppBotConversation"("accountId", "updatedAt");
CREATE UNIQUE INDEX "WhatsAppBotMessage_externalMessageId_key" ON "WhatsAppBotMessage"("externalMessageId");

ALTER TABLE "WhatsAppBotConversation" ADD CONSTRAINT "WhatsAppBotConversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsAppBotMessage" ADD CONSTRAINT "WhatsAppBotMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsAppBotConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
