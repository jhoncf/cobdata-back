-- CreateEnum
CREATE TYPE "PaymentProviderType" AS ENUM ('BANCO_DO_BRASIL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BOLETO', 'PIX', 'BOLEPIX');

-- CreateEnum
CREATE TYPE "PaymentGatewayEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');

-- CreateTable
CREATE TABLE "PaymentGateway" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" "PaymentProviderType" NOT NULL,
    "environment" "PaymentGatewayEnvironment" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "supportedMethods" "PaymentMethod"[],
    "pixKey" TEXT,
    "encryptedCredentials" TEXT NOT NULL,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGateway_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGateway_accountId_providerType_environment_key" ON "PaymentGateway"("accountId", "providerType", "environment");

-- AddForeignKey
ALTER TABLE "PaymentGateway" ADD CONSTRAINT "PaymentGateway_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
