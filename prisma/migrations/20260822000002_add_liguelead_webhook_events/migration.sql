CREATE TABLE "LigueLeadDispatchItem" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "externalCampaignId" TEXT,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "durationSeconds" INTEGER,
    "recordingUrl" TEXT,
    "transcript" JSONB,
    "actionExecuted" TEXT,
    "rawPayload" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LigueLeadDispatchItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LigueLeadWebhookEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LigueLeadWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LigueLeadDispatchItem_dispatchId_contractId_key" ON "LigueLeadDispatchItem"("dispatchId", "contractId");
CREATE INDEX "LigueLeadDispatchItem_externalCampaignId_phone_idx" ON "LigueLeadDispatchItem"("externalCampaignId", "phone");
CREATE UNIQUE INDEX "LigueLeadWebhookEvent_eventKey_key" ON "LigueLeadWebhookEvent"("eventKey");

ALTER TABLE "LigueLeadDispatchItem" ADD CONSTRAINT "LigueLeadDispatchItem_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "LigueLeadDispatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LigueLeadDispatchItem" ADD CONSTRAINT "LigueLeadDispatchItem_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LigueLeadWebhookEvent" ADD CONSTRAINT "LigueLeadWebhookEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
