-- Align table-management database objects with the current Prisma schema.
-- This keeps fresh deploys and existing databases compatible.

CREATE TABLE IF NOT EXISTS "TableManagementSettings" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL UNIQUE REFERENCES "Business"("id") ON DELETE CASCADE,
  "nichePreset" TEXT NOT NULL DEFAULT 'restaurant',
  "serviceMode" TEXT NOT NULL DEFAULT 'full_service',
  "capabilities" JSONB,
  "reservationRules" JSONB,
  "uiPreferences" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "DiningArea" (
  "id" TEXT PRIMARY KEY,
  "businessId" TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "code" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "meta" JSONB,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "DiningArea_businessId_name_key" ON "DiningArea"("businessId", "name");

ALTER TABLE "DiningTable" ADD COLUMN IF NOT EXISTS "areaId" TEXT;
ALTER TABLE "DiningTable" ADD COLUMN IF NOT EXISTS "code" TEXT;
ALTER TABLE "DiningTable" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "DiningTable" ADD COLUMN IF NOT EXISTS "shape" TEXT;
ALTER TABLE "DiningTable" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "DiningTable" ADD COLUMN IF NOT EXISTS "meta" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "DiningTable_businessId_name_key" ON "DiningTable"("businessId", "name");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DiningTable_areaId_fkey'
  ) THEN
    ALTER TABLE "DiningTable"
      ADD CONSTRAINT "DiningTable_areaId_fkey"
      FOREIGN KEY ("areaId") REFERENCES "DiningArea"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "TableReservation" ADD COLUMN IF NOT EXISTS "customerPhone" TEXT;
ALTER TABLE "TableReservation" ADD COLUMN IF NOT EXISTS "source" TEXT;
ALTER TABLE "TableReservation" ADD COLUMN IF NOT EXISTS "meta" JSONB;
ALTER TABLE "TableReservation" ADD COLUMN IF NOT EXISTS "confirmedAt" TIMESTAMP;
ALTER TABLE "TableReservation" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMP;
ALTER TABLE "TableReservation" ADD COLUMN IF NOT EXISTS "canceledAt" TIMESTAMP;
