-- Add public order tracking and table QR scan analytics.

ALTER TABLE "Order" ADD COLUMN "trackingToken" TEXT;

CREATE UNIQUE INDEX "Order_trackingToken_key" ON "Order"("trackingToken");

ALTER TABLE "TableQrCode" ADD COLUMN "scanCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TableQrCode" ADD COLUMN "lastScannedAt" DATETIME;

CREATE TABLE "TableQrScanEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "qrCodeId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "userAgent" TEXT,
  "referrer" TEXT,
  "ipHash" TEXT,
  "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TableQrScanEvent_qrCodeId_fkey" FOREIGN KEY ("qrCodeId") REFERENCES "TableQrCode" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TableQrScanEvent_qrCodeId_scannedAt_idx" ON "TableQrScanEvent"("qrCodeId", "scannedAt");
CREATE INDEX "TableQrScanEvent_businessId_scannedAt_idx" ON "TableQrScanEvent"("businessId", "scannedAt");
CREATE INDEX "TableQrScanEvent_tableId_scannedAt_idx" ON "TableQrScanEvent"("tableId", "scannedAt");
