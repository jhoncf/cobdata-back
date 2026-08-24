-- CreateTable
CREATE TABLE "LigueLeadWebhookReceipt" (
    "id" TEXT NOT NULL,
    "event" TEXT,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LigueLeadWebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LigueLeadWebhookReceipt_createdAt_idx" ON "LigueLeadWebhookReceipt"("createdAt");
