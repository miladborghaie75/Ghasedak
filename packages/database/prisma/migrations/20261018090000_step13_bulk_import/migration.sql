-- گام ۱۳ (F1-3) — دستهٔ ورود گروهی و ردیف‌های پیش‌نمایش
-- additive و بدون تغییر جدول‌های موجود: فقط enum/جدول/ایندکس تازه.

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'REVERTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP', 'ERROR');

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PRODUCTS',
    "filename" TEXT NOT NULL,
    "actorId" TEXT,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createCount" INTEGER NOT NULL DEFAULT 0,
    "updateCount" INTEGER NOT NULL DEFAULT 0,
    "skipCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "previewHash" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatchRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "action" "ImportRowAction" NOT NULL,
    "entityType" TEXT NOT NULL DEFAULT 'Product',
    "entityId" TEXT,
    "sku" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "message" TEXT,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatchRow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- CreateIndex
CREATE INDEX "ImportBatchRow_batchId_rowNo_idx" ON "ImportBatchRow"("batchId", "rowNo");

-- CreateIndex
CREATE INDEX "ImportBatchRow_sku_idx" ON "ImportBatchRow"("sku");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatchRow" ADD CONSTRAINT "ImportBatchRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
