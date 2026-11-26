-- Additive only: product barcodes for scanning at the till, and received lots (batches) linked to stock items.
ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;
CREATE UNIQUE INDEX "Product_businessId_barcode_key" ON "Product"("businessId", "barcode");

ALTER TABLE "Batch" ADD COLUMN "inventoryItemId" TEXT,
  ADD COLUMN "outletId" TEXT,
  ADD COLUMN "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "unitCost" DECIMAL(18,6),
  ADD COLUMN "receiptId" TEXT;
CREATE INDEX "Batch_businessId_inventoryItemId_idx" ON "Batch"("businessId", "inventoryItemId");
