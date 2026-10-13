-- فاز ۰٫۴ (بخش دوم) — بستن راه دور زدن «دستکاری سند موجود»
--
-- قیدهای `20261004170000` فقط **هر خط** را می‌سنجید. آزمون عملی نشان داد
-- راه دور زدن باقی است:
--     UPDATE "JournalLine" SET debit = debit + 111
-- بدون نقض هیچ‌کدام از آن قیدها، سند را نامتوازن می‌کرد.
--
-- چرا محرک سادهٔ «پس از هر INSERT» جواب نمی‌دهد:
--     `JournalService` خطوط سند را **یکی‌یکی** insert می‌کند (postManual و
--     updateEntry). بعد از خط اول سند موقتاً نامتوازن است و محرک آن را رد
--     می‌کرد — یعنی کل سیستم از کار می‌افتاد. این را با آزمون عملی دیدم.
--
-- راه‌حل: محرک فقط روی UPDATE و DELETE، یعنی همان مسیر «دستکاری سند موجود».
-- مسیر ساخت سند را `prepareLines` و تراکنش جاوااسکریپت محافظت می‌کنند و
-- سندها با `lines: { create: [...] }` یک‌جا درج می‌شوند.
--
-- معیار تشخیص «ویرایش» از «ساخت»: وجود خطوط *دیگر* برای همان سند.
-- اولین خط یک سند تازه، خطوط دیگری ندارد ⇒ ساخت ⇒ آزاد.
-- ویرایش یک سند موجود، خطوط دیگر دارد ⇒ باید متوازن بماند.

CREATE OR REPLACE FUNCTION assert_entry_balanced_on_mutate() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_entry TEXT;
  d BIGINT;
  c BIGINT;
  remaining BIGINT;
  other_lines BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_entry := OLD."entryId";
  ELSE
    target_entry := NEW."entryId";
    SELECT COUNT(*) INTO other_lines
    FROM "JournalLine"
    WHERE "entryId" = target_entry AND id IS DISTINCT FROM COALESCE(NEW.id, OLD.id);
    IF other_lines = 0 THEN
      RETURN COALESCE(NEW, OLD);
    END IF;
  END IF;

  SELECT COUNT(*) INTO remaining FROM "JournalLine" WHERE "entryId" = target_entry;
  IF remaining = 0 THEN
    RETURN COALESCE(NEW, OLD);   -- آخرین خط دارد حذف می‌شود
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0)
    INTO d, c
    FROM "JournalLine" WHERE "entryId" = target_entry;

  IF d <> c THEN
    RAISE EXCEPTION
      'سند نامتوازن شد: بدهکار % ≠ بستانکار % (entryId=%)', d, c, target_entry
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_entry_balanced_mutate ON "JournalLine";
CREATE TRIGGER trg_entry_balanced_mutate
  AFTER UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION assert_entry_balanced_on_mutate();