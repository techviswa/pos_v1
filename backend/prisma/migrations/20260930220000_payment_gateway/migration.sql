-- CreateTable
CREATE TABLE "PaymentGatewayConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "keyId" TEXT,
    "keySecretEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "webhookKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentGatewayConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentGatewayEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentGatewayEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayConfig_businessId_key" ON "PaymentGatewayConfig"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayConfig_webhookKey_key" ON "PaymentGatewayConfig"("webhookKey");

-- CreateIndex
CREATE INDEX "PaymentGatewayEvent_businessId_createdAt_idx" ON "PaymentGatewayEvent"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentGatewayConfig" ADD CONSTRAINT "PaymentGatewayConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGatewayEvent" ADD CONSTRAINT "PaymentGatewayEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

