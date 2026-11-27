-- Additive only: permanent short QR links and their scan log, with the same per-business row security as table QR codes.
CREATE TABLE "QrLink" (
  "id" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "outletId" TEXT,
  "token" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "config" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "scanCount" INTEGER NOT NULL DEFAULT 0,
  "lastScannedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "QrLink_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "QrLinkScan" (
  "id" TEXT NOT NULL,
  "qrLinkId" TEXT NOT NULL,
  "businessId" TEXT NOT NULL,
  "userAgent" TEXT,
  "ipHash" TEXT,
  "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "QrLinkScan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "QrLink_token_key" ON "QrLink"("token");
CREATE INDEX "QrLink_businessId_idx" ON "QrLink"("businessId");
CREATE INDEX "QrLinkScan_qrLinkId_scannedAt_idx" ON "QrLinkScan"("qrLinkId", "scannedAt");
CREATE INDEX "QrLinkScan_businessId_scannedAt_idx" ON "QrLinkScan"("businessId", "scannedAt");
ALTER TABLE "QrLink" ADD CONSTRAINT "QrLink_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "QrLinkScan" ADD CONSTRAINT "QrLinkScan_qrLinkId_fkey" FOREIGN KEY ("qrLinkId") REFERENCES "QrLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE public."QrLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."QrLink" FORCE ROW LEVEL SECURITY;
DO $policy$ DECLARE owner_name text; BEGIN SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='public."QrLink"'::regclass; EXECUTE format('CREATE POLICY pos_system ON public."QrLink" TO %I USING (true) WITH CHECK (true)', owner_name); END $policy$;
CREATE POLICY pos_tenant ON public."QrLink" USING ("QrLink"."businessId" = NULLIF(current_setting('pos.business_id', true), '') AND EXISTS (SELECT 1 FROM public."Business" b WHERE b.id = NULLIF(current_setting('pos.business_id', true), '') AND b."tenantId" = NULLIF(current_setting('pos.tenant_id', true), ''))) WITH CHECK ("QrLink"."businessId" = NULLIF(current_setting('pos.business_id', true), '') AND EXISTS (SELECT 1 FROM public."Business" b WHERE b.id = NULLIF(current_setting('pos.business_id', true), '') AND b."tenantId" = NULLIF(current_setting('pos.tenant_id', true), '')));

ALTER TABLE public."QrLinkScan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."QrLinkScan" FORCE ROW LEVEL SECURITY;
DO $policy$ DECLARE owner_name text; BEGIN SELECT pg_get_userbyid(relowner) INTO owner_name FROM pg_class WHERE oid='public."QrLinkScan"'::regclass; EXECUTE format('CREATE POLICY pos_system ON public."QrLinkScan" TO %I USING (true) WITH CHECK (true)', owner_name); END $policy$;
CREATE POLICY pos_tenant ON public."QrLinkScan" USING ("QrLinkScan"."businessId" = NULLIF(current_setting('pos.business_id', true), '') AND EXISTS (SELECT 1 FROM public."Business" b WHERE b.id = NULLIF(current_setting('pos.business_id', true), '') AND b."tenantId" = NULLIF(current_setting('pos.tenant_id', true), ''))) WITH CHECK ("QrLinkScan"."businessId" = NULLIF(current_setting('pos.business_id', true), '') AND EXISTS (SELECT 1 FROM public."Business" b WHERE b.id = NULLIF(current_setting('pos.business_id', true), '') AND b."tenantId" = NULLIF(current_setting('pos.tenant_id', true), '')));
CREATE FUNCTION pos_security."check_QrLinkScan"() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $fn$
BEGIN
  IF session_user = pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = TG_RELID)) THEN RETURN NEW; END IF;
  IF NEW."qrLinkId" IS NOT NULL AND EXISTS (SELECT 1 FROM public."QrLink" ref WHERE ref."id" = NEW."qrLinkId" AND ref."businessId" IS DISTINCT FROM NEW."businessId") THEN RAISE EXCEPTION 'Cross-business reference rejected' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION pos_security."check_QrLinkScan"() FROM PUBLIC;
CREATE TRIGGER pos_check_references BEFORE INSERT OR UPDATE ON public."QrLinkScan" FOR EACH ROW EXECUTE FUNCTION pos_security."check_QrLinkScan"();
