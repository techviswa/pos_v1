-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "birthday" TIMESTAMP(3),
    "anniversary" TIMESTAMP(3),
    "gender" TEXT,
    "notes" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "totalSpent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "firstVisitAt" TIMESTAMP(3),
    "lastVisitAt" TIMESTAMP(3),
    "anonymizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyEntry" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "billId" TEXT,
    "type" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "value" DECIMAL(12,2),
    "balanceAfter" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCard" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "initialValue" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "customerId" TEXT,
    "recipientName" TEXT,
    "recipientPhone" TEXT,
    "outletId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiftCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiftCardTransaction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "giftCardId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "billId" TEXT,
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "settlementShiftId" TEXT,
    "outletId" TEXT,
    "clientRequestId" TEXT,
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GiftCardTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayProfile" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "payType" TEXT NOT NULL,
    "monthlySalary" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dailyRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hourlyRate" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "basicPercent" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "allowances" JSONB NOT NULL DEFAULT '[]',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "pfEnabled" BOOLEAN NOT NULL DEFAULT false,
    "esiEnabled" BOOLEAN NOT NULL DEFAULT false,
    "professionalTax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "overtimeEligible" BOOLEAN NOT NULL DEFAULT false,
    "pan" TEXT,
    "uan" TEXT,
    "esiNumber" TEXT,
    "bankName" TEXT,
    "bankAccountLast4" TEXT,
    "ifsc" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "note" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payslip" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "role" TEXT,
    "profile" JSONB NOT NULL,
    "daysInPeriod" INTEGER NOT NULL,
    "daysPresent" INTEGER NOT NULL,
    "lopDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "hoursWorked" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "manualLines" JSONB NOT NULL DEFAULT '[]',
    "earnings" JSONB NOT NULL DEFAULT '[]',
    "deductions" JSONB NOT NULL DEFAULT '[]',
    "employerContributions" JSONB NOT NULL DEFAULT '[]',
    "gross" DECIMAL(12,2) NOT NULL,
    "totalDeductions" DECIMAL(12,2) NOT NULL,
    "netPay" DECIMAL(12,2) NOT NULL,
    "tipsPaid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "paymentReference" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payslip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_businessId_lastVisitAt_idx" ON "Customer"("businessId", "lastVisitAt");

-- CreateIndex
CREATE UNIQUE INDEX "Customer_businessId_phone_key" ON "Customer"("businessId", "phone");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_customerId_createdAt_idx" ON "LoyaltyEntry"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyEntry_billId_idx" ON "LoyaltyEntry"("billId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCard_code_key" ON "GiftCard"("code");

-- CreateIndex
CREATE INDEX "GiftCard_businessId_createdAt_idx" ON "GiftCard"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_giftCardId_createdAt_idx" ON "GiftCardTransaction"("giftCardId", "createdAt");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_billId_idx" ON "GiftCardTransaction"("billId");

-- CreateIndex
CREATE INDEX "GiftCardTransaction_settlementShiftId_idx" ON "GiftCardTransaction"("settlementShiftId");

-- CreateIndex
CREATE UNIQUE INDEX "GiftCardTransaction_businessId_clientRequestId_key" ON "GiftCardTransaction"("businessId", "clientRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PayProfile_userId_key" ON "PayProfile"("userId");

-- CreateIndex
CREATE INDEX "PayrollRun_businessId_periodFrom_idx" ON "PayrollRun"("businessId", "periodFrom");

-- CreateIndex
CREATE INDEX "Payslip_userId_idx" ON "Payslip"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Payslip_runId_userId_key" ON "Payslip"("runId", "userId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyEntry" ADD CONSTRAINT "LoyaltyEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCard" ADD CONSTRAINT "GiftCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiftCardTransaction" ADD CONSTRAINT "GiftCardTransaction_giftCardId_fkey" FOREIGN KEY ("giftCardId") REFERENCES "GiftCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayProfile" ADD CONSTRAINT "PayProfile_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayProfile" ADD CONSTRAINT "PayProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payslip" ADD CONSTRAINT "Payslip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data: screens for the new features. Managers get Customers and Gift Cards, Cashiers get Gift Cards
-- (selling cards is counter work). Payroll stays with Owners until granted.
INSERT INTO "Permission" ("id", "key", "label", "createdAt", "updatedAt")
SELECT 'perm_' || k, k, k, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM unnest(ARRAY['customers', 'gift_cards', 'payroll']) AS k
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "UserPermission" ("userId", "permissionId")
SELECT u."id", p."id"
FROM "User" u
JOIN "Role" r ON r."id" = u."roleId"
JOIN "Permission" p ON p."key" = ANY (CASE r."name"
  WHEN 'Manager' THEN ARRAY['customers', 'gift_cards']
  WHEN 'Cashier' THEN ARRAY['gift_cards']
  ELSE ARRAY[]::TEXT[] END)
ON CONFLICT DO NOTHING;

-- Data: a customer profile for every phone number already on a bill, with visits and spend so far.
CREATE TEMP TABLE "_bill_phone" ON COMMIT DROP AS
SELECT b."id" AS bill_id, b."businessId" AS business_id, b."status", b."createdAt" AS created_at,
       b."total" - CASE WHEN jsonb_typeof(b."metadata"->'refunded_amount') = 'number' THEN (b."metadata"->>'refunded_amount')::numeric ELSE 0 END AS net_total,
       NULLIF(TRIM(COALESCE(b."metadata"->>'customer_name', b."customerName")), '') AS name,
       CASE
         WHEN length(d.digits) = 12 AND left(d.digits, 2) = '91' THEN right(d.digits, 10)
         WHEN length(d.digits) = 11 AND left(d.digits, 1) = '0' THEN right(d.digits, 10)
         ELSE d.digits
       END AS phone
FROM "Bill" b
CROSS JOIN LATERAL (SELECT regexp_replace(COALESCE(b."metadata"->>'customer_phone', ''), '\D', '', 'g') AS digits) d;

DELETE FROM "_bill_phone" WHERE length(phone) < 8 OR length(phone) > 15;

INSERT INTO "Customer" ("id", "businessId", "phone", "name", "visitCount", "totalSpent", "firstVisitAt", "lastVisitAt", "createdAt", "updatedAt")
SELECT 'cust_' || md5(business_id || ':' || phone), business_id, phone,
       COALESCE((array_agg(name ORDER BY created_at DESC) FILTER (WHERE name IS NOT NULL AND lower(name) NOT IN ('walk-in', 'walk-in customer', 'guest')))[1], 'Guest'),
       count(*) FILTER (WHERE status <> 'void'),
       COALESCE(sum(GREATEST(net_total, 0)) FILTER (WHERE status <> 'void'), 0),
       min(created_at), max(created_at), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "_bill_phone"
GROUP BY business_id, phone
ON CONFLICT ("businessId", "phone") DO NOTHING;

-- Each old bill records what it already added to the profile (so a later refund adjusts it exactly once) and is
-- marked as from before the loyalty programme (it never earns points retroactively).
UPDATE "Bill" b
SET "metadata" = COALESCE(b."metadata", '{}'::jsonb) || jsonb_build_object(
  'customer_id', c."id",
  'loyalty_exempt', true,
  'customer_stats', jsonb_build_object(
    'visit', CASE WHEN bp."status" <> 'void' THEN 1 ELSE 0 END,
    'spent', CASE WHEN bp."status" <> 'void' THEN ROUND(GREATEST(bp.net_total, 0), 2) ELSE 0 END))
FROM "_bill_phone" bp
JOIN "Customer" c ON c."businessId" = bp.business_id AND c."phone" = bp.phone
WHERE b."id" = bp.bill_id;
