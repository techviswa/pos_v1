-- Additive only: bills changed since a moment (shift summaries, dashboard day refresh) without reading every bill.
CREATE INDEX IF NOT EXISTS "Bill_businessId_updatedAt_idx" ON "Bill"("businessId", "updatedAt");
