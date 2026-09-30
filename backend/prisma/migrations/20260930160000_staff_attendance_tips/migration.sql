-- AlterTable
ALTER TABLE "User" ADD COLUMN     "clockPinFailures" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clockPinHash" TEXT,
ADD COLUMN     "clockPinLockedUntil" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AttendanceEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "outletId" TEXT,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "userRole" TEXT,
    "clockInAt" TIMESTAMP(3) NOT NULL,
    "clockOutAt" TIMESTAMP(3),
    "breaks" JSONB NOT NULL DEFAULT '[]',
    "source" TEXT NOT NULL DEFAULT 'self',
    "note" TEXT,
    "edits" JSONB NOT NULL DEFAULT '[]',
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "deleteReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tip" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "outletId" TEXT,
    "billId" TEXT,
    "pooled" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT,
    "recipientName" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "source" TEXT NOT NULL,
    "method" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TipPayout" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "outletId" TEXT,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "note" TEXT,
    "paidById" TEXT,
    "paidByName" TEXT,
    "clientRequestId" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TipPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AttendanceEntry_businessId_clockInAt_idx" ON "AttendanceEntry"("businessId", "clockInAt");

-- CreateIndex
CREATE INDEX "AttendanceEntry_userId_clockInAt_idx" ON "AttendanceEntry"("userId", "clockInAt");

-- CreateIndex
CREATE UNIQUE INDEX "Tip_billId_key" ON "Tip"("billId");

-- CreateIndex
CREATE INDEX "Tip_businessId_createdAt_idx" ON "Tip"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Tip_userId_idx" ON "Tip"("userId");

-- CreateIndex
CREATE INDEX "TipPayout_businessId_periodFrom_idx" ON "TipPayout"("businessId", "periodFrom");

-- CreateIndex
CREATE INDEX "TipPayout_userId_idx" ON "TipPayout"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TipPayout_businessId_clientRequestId_key" ON "TipPayout"("businessId", "clientRequestId");

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceEntry" ADD CONSTRAINT "AttendanceEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_billId_fkey" FOREIGN KEY ("billId") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tip" ADD CONSTRAINT "Tip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPayout" ADD CONSTRAINT "TipPayout_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TipPayout" ADD CONSTRAINT "TipPayout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: one permission per screen. Screens that used to be open to a role by name become permissions, so every
-- existing account keeps exactly the screens its role already opened (Owners hold everything implicitly).
INSERT INTO "Permission" ("id", "key", "label", "createdAt", "updatedAt")
SELECT 'perm_' || k, k, k, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM unnest(ARRAY['reservations', 'qr_management', 'manager_view', 'waiter_view', 'kitchen_view', 'price_rules', 'attendance', 'tips', 'staff']) AS k
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "UserPermission" ("userId", "permissionId")
SELECT u."id", p."id"
FROM "User" u
JOIN "Role" r ON r."id" = u."roleId"
JOIN "Permission" p ON p."key" = ANY (CASE r."name"
  WHEN 'Manager' THEN ARRAY['staff', 'reservations', 'qr_management', 'manager_view', 'price_rules', 'attendance', 'tips']
  WHEN 'Waiter' THEN ARRAY['waiter_view']
  WHEN 'Chef' THEN ARRAY['kitchen_view']
  ELSE ARRAY[]::TEXT[] END)
ON CONFLICT DO NOTHING;

-- Data: tips already collected on QR bills become pooled tip records.
INSERT INTO "Tip" ("id", "businessId", "outletId", "billId", "pooled", "amount", "source", "createdAt", "updatedAt")
SELECT 'tip_' || b."id", b."businessId", NULLIF(b."metadata"->>'outlet_id', ''), b."id", true,
       ROUND((b."metadata"->>'tip_amount')::numeric, 2), 'qr', b."createdAt", CURRENT_TIMESTAMP
FROM "Bill" b
WHERE jsonb_typeof(b."metadata"->'tip_amount') = 'number' AND (b."metadata"->>'tip_amount')::numeric > 0
ON CONFLICT DO NOTHING;
