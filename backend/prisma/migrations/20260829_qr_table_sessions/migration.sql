CREATE TABLE "TableSession" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "qrCodeId" TEXT,
    "sessionKey" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'qr',
    "status" TEXT NOT NULL DEFAULT 'active',
    "customerName" TEXT,
    "customerPhone" TEXT,
    "guestCount" INTEGER,
    "metadata" JSONB,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TableSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TableSession_sessionKey_key" ON "TableSession"("sessionKey");
CREATE INDEX "TableSession_businessId_status_idx" ON "TableSession"("businessId", "status");
CREATE INDEX "TableSession_tableId_status_idx" ON "TableSession"("tableId", "status");
CREATE INDEX "TableSession_qrCodeId_idx" ON "TableSession"("qrCodeId");

ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TableSession" ADD CONSTRAINT "TableSession_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "TableQrCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
