-- فاز ۰ — سیستم سال مالی
--
-- هدف: تضمین اینکه در هر لحظه **دقیقاً یک** سال مالی باز وجود داشته باشد.
--
-- چرا این مهاجرت لازم است:
--   کد ساخت سند (journal.service.ts) سال باز را با
--   `findFirst({ where: { state: "OPEN" } })` پیدا می‌کند. اگر چند سال باز
--   باشد، سندها بین آن‌ها پخش می‌شوند و چون شمارهٔ سند فقط در محدودهٔ
--   یک سال یکتاست، شماره‌ها تکراری و بی‌اعتبار می‌شوند.
--   روی دیتابیس توسعه ۵ سال OPEN هم‌زمان وجود داشت.

-- ۱) ستون‌های ممیزی و اسنپ‌شات اختتامیه
ALTER TABLE "FiscalYear" ADD COLUMN IF NOT EXISTS "closedAt" TIMESTAMP(3);
ALTER TABLE "FiscalYear" ADD COLUMN IF NOT EXISTS "closedById" TEXT;
ALTER TABLE "FiscalYear" ADD COLUMN IF NOT EXISTS "reopenedAt" TIMESTAMP(3);
ALTER TABLE "FiscalYear" ADD COLUMN IF NOT EXISTS "reopenedById" TEXT;
ALTER TABLE "FiscalYear" ADD COLUMN IF NOT EXISTS "closingSnapshot" JSONB;

-- ۱٫ب) ستون‌های ردیابی که در اسکیما اضافه شده‌اند ولی در جدول ساخته‌شده نبودند.
--      جدول FiscalYear از مهاجرت پایه آمده و createdAt نداشت؛ ترتیب مرتب‌سازی
--      در گام پاک‌سازی به آن نیاز دارد.
ALTER TABLE "FiscalYear" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3);
ALTER TABLE "FiscalYear" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3);
UPDATE "FiscalYear" SET "createdAt" = COALESCE("createdAt", "startsAt"), "updatedAt" = COALESCE("updatedAt", NOW()) WHERE "createdAt" IS NULL;
ALTER TABLE "FiscalYear" ALTER COLUMN "createdAt" SET DEFAULT CURRENT_TIMESTAMP;

-- ۲) ردیابی (برای اینکه «سال باز» سریع و قطعی پیدا شود)
CREATE INDEX IF NOT EXISTS "FiscalYear_state_idx" ON "FiscalYear"("state");
CREATE INDEX IF NOT EXISTS "FiscalYear_startsAt_idx" ON "FiscalYear"("startsAt");

-- ۳) پاک‌سازی سال‌های باز تکراری
--    فقط جدیدترین سال باز نگه داشته می‌شود؛ بقیه LOCKED می‌شوند تا
--    اسنادشان از دست نرود. این کار پیش از افزودن قید لازم است وگرنه
--    افزودن قید شکست می‌خورد.
UPDATE "FiscalYear" fy
SET "state" = 'LOCKED',
    "closedAt" = COALESCE("closedAt", NOW())
WHERE fy."state" = 'OPEN'
  AND fy."id" <> (
    SELECT id FROM "FiscalYear"
    WHERE "state" = 'OPEN'
    ORDER BY "startsAt" DESC, "createdAt" DESC
    LIMIT 1
  );

-- ۴) قید: حداکثر یک سال باز
--    از این لحظه کد نمی‌تواند دو سال OPEN بسازد، حتی با درخواست هم‌زمان.
CREATE UNIQUE INDEX IF NOT EXISTS "onlyOneOpenFiscalYear"
  ON "FiscalYear" ("state")
  WHERE "state" = 'OPEN';