-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "paymentChargeId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentEvent_paymentChargeId_createdAt_idx" ON "PaymentEvent"("paymentChargeId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentChargeId_fkey" FOREIGN KEY ("paymentChargeId") REFERENCES "PaymentCharge"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
