-- CreateTable
CREATE TABLE "TableQrCode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP NOT NULL,
    "rotatedAt" TIMESTAMP,
    CONSTRAINT "TableQrCode_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TableQrCode_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "DiningTable" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TableQrCode_tableId_key" ON "TableQrCode"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "TableQrCode_token_key" ON "TableQrCode"("token");

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "metadata" JSONB;
