ALTER TABLE "OutletInventory" ADD COLUMN "unitCost" DOUBLE PRECISION;
ALTER TABLE "InventoryMovement"
  ADD COLUMN "outletId" TEXT,
  ADD COLUMN "unitCost" DOUBLE PRECISION,
  ADD COLUMN "quantityBefore" DOUBLE PRECISION,
  ADD COLUMN "quantityAfter" DOUBLE PRECISION,
  ADD COLUMN "valueBefore" DOUBLE PRECISION,
  ADD COLUMN "valueAfter" DOUBLE PRECISION,
  ADD COLUMN "referenceId" TEXT;
CREATE INDEX "InventoryMovement_businessId_inventoryItemId_outletId_createdAt_idx"
  ON "InventoryMovement" ("businessId", "inventoryItemId", "outletId", "createdAt");
