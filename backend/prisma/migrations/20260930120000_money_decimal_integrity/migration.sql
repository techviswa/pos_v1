-- Money columns move from binary floating point to exact decimals. Existing values are rounded half-up to the
-- column scale by PostgreSQL; a pre-migration check found no stored value with more precision than that.

-- Bill -> Order: a billed order can no longer be deleted on its own (was ON DELETE SET NULL, which orphaned bills).
ALTER TABLE "Bill" DROP CONSTRAINT "Bill_orderId_fkey";

ALTER TABLE "Addon" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "Bill" ADD COLUMN "invoiceNumber" TEXT,
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "tax" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "BillItem" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "InventoryItem" ALTER COLUMN "conversionCost" SET DATA TYPE DECIMAL(18,6);

ALTER TABLE "InventoryMovement" ALTER COLUMN "unitCost" SET DATA TYPE DECIMAL(18,6),
ALTER COLUMN "valueBefore" SET DATA TYPE DECIMAL(18,6),
ALTER COLUMN "valueAfter" SET DATA TYPE DECIMAL(18,6);

ALTER TABLE "Order" ALTER COLUMN "total" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "OrderItem" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "OutletInventory" ALTER COLUMN "unitCost" SET DATA TYPE DECIMAL(18,6);

ALTER TABLE "OutletProduct" ALTER COLUMN "priceOverride" SET DATA TYPE DECIMAL(12,2);

ALTER TABLE "Product" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "costPrice" SET DATA TYPE DECIMAL(18,6);

ALTER TABLE "Variation" ALTER COLUMN "price" SET DATA TYPE DECIMAL(12,2);

-- Invoice numbers become a real column so uniqueness per business is enforced by the database.
UPDATE "Bill" SET "invoiceNumber" = "metadata"->>'invoice_number'
WHERE "metadata" IS NOT NULL AND COALESCE("metadata"->>'invoice_number', '') <> '';

CREATE UNIQUE INDEX "Bill_businessId_invoiceNumber_key" ON "Bill"("businessId", "invoiceNumber");

-- One kitchen ticket per order, guaranteed by the database rather than only by application locking.
CREATE UNIQUE INDEX "KitchenTicket_orderId_key" ON "KitchenTicket"("orderId");

ALTER TABLE "Bill" ADD CONSTRAINT "Bill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Aligns an index name that PostgreSQL truncated in an earlier migration with the name Prisma expects.
ALTER INDEX IF EXISTS "InventoryMovement_businessId_inventoryItemId_outletId_createdAt" RENAME TO "InventoryMovement_businessId_inventoryItemId_outletId_creat_idx";
