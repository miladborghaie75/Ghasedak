-- زیرحساب جدا برای هر بانک (تصمیم کاربر: گزینهٔ الف)
--
-- مسئله‌ای که این حل می‌کند: `BankAccount.glAccountId` اجباری بود و همهٔ
-- حساب‌های بانکی روی `1100` می‌نشستند. یعنی اگر سه بانک داشته باشید،
-- دفتر هر سه یکی است و «مغایرت‌گیری بانکی» جواب نمی‌دهد — نمی‌شود فهمید
-- کدام گردش مال کدام بانک است.
--
-- راه‌حل: `1100` گروه می‌شود و هر بانک یک زیرحساب مستقل می‌گیرد
-- (`1100-01`، `1100-02`، …). ماندهٔ گروه `1100` همچنان جمع کل بانک‌ها
-- را نشان می‌دهد (چون گزارش‌ها سطح ۱ را هم می‌خوانند)، ولی هر بانک
-- ماندهٔ خودش را دارد.

-- زیرحساب‌های آمادهٔ بانک — تا ۲۰ حساب
INSERT INTO "Account" ("id", "code", "name", "type", "parentAccountId", "level", "isActive", "createdAt", "updatedAt")
SELECT
  substr(md5(random()::text || clock_timestamp()::text || lpad(n::text, 3, '0')), 1, 24),
  '1100-' || lpad(n::text, 2, '0'),
  'حساب بانکی شمارهٔ ' || lpad(n::text, 2, '0'),
  'ASSET',
  (SELECT id FROM "Account" WHERE code = '1100'),
  2, true, NOW(), NOW()
FROM generate_series(1, 20) AS n
ON CONFLICT ("code") DO NOTHING;

-- همین کار برای صندوق‌ها: همهٔ صندوق‌ها هم روی `1000` می‌نشستند
INSERT INTO "Account" ("id", "code", "name", "type", "parentAccountId", "level", "isActive", "createdAt", "updatedAt")
SELECT
  substr(md5(random()::text || clock_timestamp()::text || 'c' || lpad(n::text, 3, '0')), 1, 24),
  '1000-' || lpad(n::text, 2, '0'),
  'صندوق شمارهٔ ' || lpad(n::text, 2, '0'),
  'ASSET',
  (SELECT id FROM "Account" WHERE code = '1000'),
  2, true, NOW(), NOW()
FROM generate_series(1, 20) AS n
ON CONFLICT ("code") DO NOTHING;