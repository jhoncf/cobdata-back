ALTER TABLE "Wallet" ADD COLUMN "cobcomDiscountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
ALTER TABLE "Contract" ADD COLUMN "acceptedDiscountPercent" DECIMAL(5,2), ADD COLUMN "agreedPaymentAmount" DECIMAL(15,2);
ALTER TABLE "PaymentCharge" ADD COLUMN "baseAmount" DECIMAL(15,2), ADD COLUMN "discountPercent" DECIMAL(5,2) NOT NULL DEFAULT 0;
