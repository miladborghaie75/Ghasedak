-- فاز ۰٫۴ — قید سخت توازن دفتر
--
-- تا این مهاجرت، توازن فقط در لایهٔ اپ (`JournalService.prepareLines`) بررسی
-- می‌شد. یعنی هر مسیری که از آن سرویس دور شود — اسکریپت، مهاجرت، کنسول
-- SQL، باگ در آینده — می‌توانست سند نامتوازن بنویسد و چیزی جلویش را
-- نمی‌گرفت. چنین سندی بعداً باید دستی شکار شود.
--
-- این قید آخرین لایهٔ دفاع است: حتی اگر همهٔ لایه‌های بالا دور زده شوند،
-- خود دیتابیس سند نامتوازن را رد می‌کند.
--
-- دو قید جدا لازم است:
--   ۱) هر خط باید یا بدهکار یا بستانکار باشد (نه هر دو، نه هیچ‌کدام)
--   ۲) مبلغ‌ها نباید منفی باشند

-- ۱) هر خط دقیقاً یک‌ طرف دارد
ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS "JournalLine_one_side_only";
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_one_side_only"
  CHECK (
    (debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
  );

-- ۲) نه منفی
ALTER TABLE "JournalLine" DROP CONSTRAINT IF EXISTS "JournalLine_non_negative";
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_non_negative"
  CHECK (debit >= 0 AND credit >= 0);

-- ۳) ایندکس برای بررسی سریع دفتر در تست یکپارچگی
CREATE INDEX IF NOT EXISTS "JournalLine_entryId_debit_credit_idx" ON "JournalLine"("entryId", "debit", "credit");

-- ── بررسی داده‌های موجود قبل از سخت‌کردن قید ──
-- اگر سند نامتوازنی از قبل در دیتابیس باشد، افزودن قید شکست می‌خورد.
-- گزارش می‌گیرد تا به‌جای حدس، ببینیم چه چیزی هست.
DO $$
DECLARE
  bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM "JournalEntry" e
  WHERE (
    SELECT COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0)
    FROM "JournalLine" l WHERE l."entryId" = e.id
  ) <> 0;

  IF bad_count > 0 THEN
    RAISE WARNING 'هشدار: % سند نامتوازن در دیتابیس وجود دارد — قید افزوده شد ولی این اسناد نیاز به بررسی دارند', bad_count;
  END IF;
END $$;