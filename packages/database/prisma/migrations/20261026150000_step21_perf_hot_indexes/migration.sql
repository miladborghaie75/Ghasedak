-- گام ۲۱ (ایستگاه ۵) — کارایی + رفع drift افزایشی بین schema.prisma و migrations
--
-- با اجرای diff (from-migrations → to-schema-datamodel) دقیقاً ۸ مورد drift پیدا شد
-- که همه با همین migration افزایشی بسته می‌شوند:
--
--   ۱) ایندکس‌های داغ: فهرست سفارش‌ها (status+createdAt و مرتب‌سازی خالص
--      createdAt)، کاتالوگ (محصولات منتشرشده) و نظرات — پرس‌وجوهای پرتکرار
--      فروشگاه که در EXPLAIN روی دادهٔ تست Seq Scan بودند و در حجم واقعی
--      ایندکس لازم دارند.
--   ۲) پیش‌فرض updatedAt روی جدول‌های AI (مطابق @default(now()) در schema).
--   ۳) کلید خارجی PayrollItem → User (در schema اعلام شده بود ولی migration
--      نداشت؛ سطرهای یتیم قبل از اجرا صفر بررسی شد).
--
-- همهٔ دستورها idempotent هستند (IF NOT EXISTS / DROP IF EXISTS) — طبق
-- قرارداد migrationهای دستی این پروژه.

-- ۱) ایندکس‌های داغ
CREATE INDEX IF NOT EXISTS "Order_status_createdAt_idx"   ON "Order"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Order_createdAt_idx"          ON "Order"("createdAt");
CREATE INDEX IF NOT EXISTS "Product_status_createdAt_idx" ON "Product"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Review_status_createdAt_idx"  ON "Review"("status", "createdAt");

-- ۲) پیش‌فرض ستون updatedAt جدول‌های AI
ALTER TABLE "AiUsageDay"      ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AiUserDay"       ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "RateLimitWindow" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- ۳) کلید خارجی PayrollItem → User
ALTER TABLE "PayrollItem" DROP CONSTRAINT IF EXISTS "PayrollItem_userId_fkey";
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- ۴) تضمین وجود enum اعلام‌شده در schema (SettlementStatus)
-- phase2_settlement این را داخل DO block می‌سازد، ولی محیط‌هایی که با baseline
-- بازیابی شده‌اند ممکن است آن را نداشته باشند → اینجا idempotent تضمین می‌شود.
DO $$ BEGIN
  CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'POSTED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
