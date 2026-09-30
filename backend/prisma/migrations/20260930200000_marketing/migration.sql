-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "marketingConsentAt" TIMESTAMP(3),
ADD COLUMN     "marketingOptOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MarketingConfig" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsappPhoneNumberId" TEXT,
    "whatsappBusinessAccountId" TEXT,
    "whatsappAccessTokenEnc" TEXT,
    "whatsappAppSecretEnc" TEXT,
    "whatsappVerifyToken" TEXT,
    "smsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "smsProvider" TEXT,
    "smsSenderId" TEXT,
    "smsDltEntityId" TEXT,
    "smsCredentialsEnc" TEXT,
    "smsWebhookKey" TEXT NOT NULL,
    "sendWindowStart" INTEGER NOT NULL DEFAULT 600,
    "sendWindowEnd" INTEGER NOT NULL DEFAULT 1260,
    "utcOffsetMinutes" INTEGER NOT NULL DEFAULT 330,
    "weeklyCap" INTEGER NOT NULL DEFAULT 2,
    "whatsappCostPerMessage" DECIMAL(8,4) NOT NULL DEFAULT 0.88,
    "smsCostPerMessage" DECIMAL(8,4) NOT NULL DEFAULT 0.25,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingTemplate" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsappTemplateName" TEXT,
    "language" TEXT,
    "dltTemplateId" TEXT,
    "providerTemplateId" TEXT,
    "body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingCampaign" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'one_time',
    "audience" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "sendHour" INTEGER,
    "lastRunOn" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMessage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "runKey" TEXT NOT NULL DEFAULT 'once',
    "channel" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "body" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "skipReason" TEXT,
    "providerMessageId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MarketingConfig_businessId_key" ON "MarketingConfig"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingConfig_whatsappPhoneNumberId_key" ON "MarketingConfig"("whatsappPhoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingConfig_smsWebhookKey_key" ON "MarketingConfig"("smsWebhookKey");

-- CreateIndex
CREATE INDEX "MarketingTemplate_businessId_idx" ON "MarketingTemplate"("businessId");

-- CreateIndex
CREATE INDEX "MarketingCampaign_businessId_status_idx" ON "MarketingCampaign"("businessId", "status");

-- CreateIndex
CREATE INDEX "MarketingMessage_status_nextAttemptAt_idx" ON "MarketingMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "MarketingMessage_providerMessageId_idx" ON "MarketingMessage"("providerMessageId");

-- CreateIndex
CREATE INDEX "MarketingMessage_customerId_sentAt_idx" ON "MarketingMessage"("customerId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMessage_campaignId_customerId_runKey_key" ON "MarketingMessage"("campaignId", "customerId", "runKey");

-- AddForeignKey
ALTER TABLE "MarketingConfig" ADD CONSTRAINT "MarketingConfig_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingTemplate" ADD CONSTRAINT "MarketingTemplate_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingCampaign" ADD CONSTRAINT "MarketingCampaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MarketingTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "MarketingCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: the Marketing screen (Owner-only until granted), and a consent date for guests who already opted in.
INSERT INTO "Permission" ("id", "key", "label", "createdAt", "updatedAt")
VALUES ('perm_marketing', 'marketing', 'marketing', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

UPDATE "Customer" SET "marketingConsentAt" = "updatedAt" WHERE "marketingOptIn" = true AND "marketingConsentAt" IS NULL;
