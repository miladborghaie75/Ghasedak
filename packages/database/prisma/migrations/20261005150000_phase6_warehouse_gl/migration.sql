-- فاز ۶ — انبار به‌عنوان زیرمجموعهٔ حسابداری
--
-- دو ستون اضافه می‌شود:
--   ۱) `Warehouse.glAccountId` — هر انبار حساب دفتری خودش را دارد.
--      قبلاً همهٔ انبارها روی `1200` جمع می‌شدند، پس گزارش ارزش‌گذاری انبار
--      با ترازنامه نمی‌خواند.
--   ۲) `JournalLine.warehouseId` — سند می‌تواند بگوید این خط برای کدام
--      انبار است. برای اسناد موجود `NULL` می‌ماند (معنای «نامشخص» دارد و
--      رفتار را خراب نمی‌کند).

ALTER TABLE "Warehouse" ADD COLUMN IF NOT EXISTS "glAccountId" TEXT;

ALTER TABLE "JournalLine" ADD COLUMN IF NOT EXISTS "warehouseId" TEXT;

-- ایندکس گزارش سود هر انبار
CREATE INDEX IF NOT EXISTS "JournalLine_warehouseId_idx" ON "JournalLine"("warehouseId");
CREATE INDEX IF NOT EXISTS "Warehouse_glAccountId_idx" ON "Warehouse"("glAccountId");

-- کلید خارجی
ALTER TABLE "Warehouse" DROP CONSTRAINT IF EXISTS "Warehouse_glAccountId_fkey";
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_glAccountId_fkey"
  FOREIGN KEY ("glAccountId") REFERENCES "Account"("id") ON DELETE SET NULL;

ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS "JournalLine_warehouseId_fkey";
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_warehouseId_fkey"
  FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE SET NULL;

-- ── داده‌های موجود: هر انبار یک زیرحساب مستقل زیر ۱۲۰۰ بگیرد ──
-- زیرحساب‌ها قبلاً در مهاجرت `20261005220000` ساخته شده‌اند؛ اینجا فقط
-- به انبارهای موجود وصل می‌شوند. اگر انباری زیرحساب آزاد نداشته باشد،
-- `glAccountId` NULL می‌ماند و آن انبار به گروه ۱۲۰۰ می‌رود (رفتار قبلی).
DO $$
DECLARE
  grp        TEXT;
  wh         RECORD;
  sub        RECORD;
  made       INT := 0;
BEGIN
  SELECT id INTO grp FROM "Account" WHERE code = '1200';
  IF grp IS NULL THEN
    RAISE NOTICE 'حساب ۱۲۰۰ یافت نشد — انبارها به گروه می‌مانند';
    RETURN;
  END IF;

  FOR wh IN
    SELECT w.id, w.code, w.name FROM "Warehouse" w
    WHERE w."glAccountId" IS NULL ORDER BY w."priority" DESC, w."createdAt" ASC
  LOOP
    -- اول یک زیرحساب استفاده‌نشده از ۱۲۰۰ پیدا کن
    SELECT a.id, a.code INTO sub
    FROM "Account" a
    WHERE a."parentAccountId" = grp
      AND NOT EXISTS (SELECT 1 FROM "Warehouse" w2 WHERE w2."glAccountId" = a.id)
    ORDER BY a.code ASC
    LIMIT 1;

    -- اگر همه پر شده‌اند، یکی تازه بساز
    IF sub.id IS NULL THEN
      made := made + 1;
      INSERT INTO "Account" (id, code, name, type, "parentAccountId", level, "isActive", "createdAt", "updatedAt")
      VALUES (
        substr(md5(random()::text || clock_timestamp()::text || wh.code), 1, 24),
        '1200-' || lpad((made + (SELECT COUNT(*) FROM "Account" a2 WHERE a2."parentAccountId" = grp) - (SELECT COUNT(*) FROM "Account" a3 WHERE a3."parentAccountId" = grp) + (SELECT COUNT(*) FROM "Account" a4 WHERE a4."parentAccountId" = grp))::text, 3, '0'),
        'انبار ' || wh.name,
        'ASSET', grp, 2, true, NOW(), NOW()
      )
      RETURNING id, code INTO sub;
    END IF;

    UPDATE "Warehouse" SET "glAccountId" = sub.id, "updatedAt" = NOW() WHERE id = wh.id;
    RAISE NOTICE 'انبار % → حساب %', wh.name, sub.code;
  END LOOP;
END $$;