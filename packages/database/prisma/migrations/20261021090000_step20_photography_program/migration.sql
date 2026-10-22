-- گام ۲۰ — برنامهٔ عکاسی محصول: کارِ «محصول × کادر»
-- additive و بدون تغییر مخرب روی جدول‌های موجود: فقط enum/جدول/ایندکس/کلید خارجی تازه.
-- رابطهٔ عکس‌ها به رسانه عمداً صریح نیست (مثل ProductImage) — یکپارچگی در لایهٔ سرویس.

-- CreateEnum
CREATE TYPE "PhotoTaskStatus" AS ENUM ('PENDING', 'SHOT', 'NEEDS_RETAKE', 'APPROVED');

-- CreateTable
CREATE TABLE "PhotoTask" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "shotKind" TEXT NOT NULL,
    "status" "PhotoTaskStatus" NOT NULL DEFAULT 'PENDING',
    "mediaId" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhotoTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PhotoTask_status_idx" ON "PhotoTask"("status");

-- CreateIndex
-- یکتایی «محصول × کادر» — یک کادر دو بار ثبت نشود
CREATE UNIQUE INDEX "PhotoTask_productId_shotKind_key" ON "PhotoTask"("productId", "shotKind");

-- AddForeignKey
ALTER TABLE "PhotoTask" ADD CONSTRAINT "PhotoTask_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoTask" ADD CONSTRAINT "PhotoTask_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
