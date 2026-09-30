-- AlterTable
ALTER TABLE "BillItem" ADD COLUMN     "modifiers" JSONB;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "modifiers" JSONB;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "isCombo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ModifierGroup" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModifierGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModifierOption" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "linkedProductId" TEXT,
    "recipeLines" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ModifierOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComboComponent" (
    "id" TEXT NOT NULL,
    "comboProductId" TEXT NOT NULL,
    "componentProductId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ComboComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "discountType" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "daysOfWeek" INTEGER[],
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "channels" TEXT[],
    "outletIds" TEXT[],
    "productIds" TEXT[],
    "categories" TEXT[],
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModifierGroup_productId_idx" ON "ModifierGroup"("productId");

-- CreateIndex
CREATE INDEX "ModifierOption_groupId_idx" ON "ModifierOption"("groupId");

-- CreateIndex
CREATE INDEX "ComboComponent_componentProductId_idx" ON "ComboComponent"("componentProductId");

-- CreateIndex
CREATE UNIQUE INDEX "ComboComponent_comboProductId_componentProductId_key" ON "ComboComponent"("comboProductId", "componentProductId");

-- CreateIndex
CREATE INDEX "PriceRule_businessId_active_idx" ON "PriceRule"("businessId", "active");

-- AddForeignKey
ALTER TABLE "ModifierGroup" ADD CONSTRAINT "ModifierGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModifierOption" ADD CONSTRAINT "ModifierOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ModifierGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_comboProductId_fkey" FOREIGN KEY ("comboProductId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComboComponent" ADD CONSTRAINT "ComboComponent_componentProductId_fkey" FOREIGN KEY ("componentProductId") REFERENCES "Product"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Outlet menus had two sources: the OutletProduct table (used when selling) and a JSON copy on the product (edited
-- on the Products screen but never applied). Copy any JSON-only overrides into OutletProduct, which is the single
-- source from now on; existing OutletProduct rows win.
INSERT INTO "OutletProduct" ("id", "outletId", "productId", "enabled", "priceOverride", "createdAt", "updatedAt")
SELECT md5(random()::text || p."id" || (entry->>'outlet_id')), entry->>'outlet_id', p."id",
       COALESCE(entry->>'status', 'inherit') <> 'inactive',
       CASE WHEN COALESCE(entry->>'price', '') ~ '^[0-9]+(\.[0-9]+)?$' THEN (entry->>'price')::numeric ELSE NULL END,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Product" p
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(p."outletOverrides") = 'array' THEN p."outletOverrides" ELSE '[]'::jsonb END) AS entry
JOIN "Outlet" o ON o."id" = entry->>'outlet_id' AND o."businessId" = p."businessId"
ON CONFLICT ("outletId", "productId") DO NOTHING;
