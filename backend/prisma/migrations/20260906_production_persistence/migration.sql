CREATE TABLE "BackgroundJob" (
  "id" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'queued',
  "attempts" INTEGER NOT NULL DEFAULT 0, "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "payload" JSONB NOT NULL, "result" JSONB, "error" TEXT,
  "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3), "leaseToken" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "BackgroundJob_status_runAt_idx" ON "BackgroundJob"("status", "runAt");
CREATE TABLE "AdminCoreSyncLog" (
  "id" TEXT PRIMARY KEY, "tenantId" TEXT, "resource" TEXT NOT NULL, "status" TEXT NOT NULL,
  "data" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminCoreSyncLog_tenantId_createdAt_idx" ON "AdminCoreSyncLog"("tenantId", "createdAt");
CREATE TABLE "StateDocument" ("key" TEXT PRIMARY KEY, "data" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL);
CREATE TABLE "DocumentSequence" ("key" TEXT PRIMARY KEY, "value" INTEGER NOT NULL);
CREATE TABLE "AuthSession" (
  "tokenHash" TEXT PRIMARY KEY, "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
