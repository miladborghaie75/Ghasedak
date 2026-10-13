-- فاز ۰٫۳ — کدینگ استاندارد بازرگانی
--
-- هدف: تفکیک هزینه‌ها و درآمدها که قبلاً همه در یک حساب می‌ریختند.
-- ضایعات انبار، کسری انبارگردانی، حقوق، کارمزد درگاه و هزینهٔ نقدی
-- همه داخل `6000` بودند ⇒ دفتر متوازن بود ولی تحلیل هزینه غیرممکن بود.
--
-- اصل «بدون شکستن گذشته»:
--   ۱) حساب‌های level 1 **همان ۱۲ حساب قبلی** هستند (کد عوض نمی‌شود)،
--      فقط parent/level درست می‌شود.
--   ۲) اسناد موجود به این حساب‌ها اشاره دارند و چون کد عوض نشده، سالم می‌مانند.
--   ۳) زیرحساب‌ها فقط **ساختار تحلیلی** می‌سازند؛ سرویس‌ها در فاز ۲ به آن‌ها
--      سوییچ می‌کنند. تا آن زمان سندها روی گروه اصلی می‌نشینند که درست است.

-- ── ۱) گروه‌های اصلی: سطح درست و بدون والد ──
--    تا قبل از این مهاجرت level پیش‌فرض ۱ بود و parentAccountId خالی؛
--    این عملاً درست بود ولی صریح می‌کنیم که تکرارپذیر نباشد.
UPDATE "Account" SET "parentAccountId" = NULL, "level" = 1
WHERE "code" IN ('1000','1100','1200','1210','1220','2100','2110','2150','3000','3900','4000','5000','6000');

-- ── ۱٫ب) حساب سود و زیان انباشته ──
--    سند اختتامیه درآمد و هزینهٔ دوره را اینجا می‌بندد تا ترازنامه
--    فقط دارایی/بدهی/سرمایه نشان دهد. قبلاً وجود نداشت و به‌اجبار روی
--    حساب سرمایهٔ کل (`3000`) می‌نشست که گردش مالک را قاطی سود می‌کرد.
INSERT INTO "Account" ("id", "code", "name", "type", "parentAccountId", "level", "isActive", "createdAt", "updatedAt")
SELECT substr(md5(random()::text || clock_timestamp()::text || 'retained'), 1, 24),
       '3900', 'سود و زیان انباشته', 'EQUITY', NULL, 1, true, NOW(), NOW()
ON CONFLICT ("code") DO NOTHING;

-- ── ۲) زیرحساب‌های هزینه ──
--    catchAll ندارند چون والدشان موجود است و فقط نوع/سطح پر می‌شود.
--    `id` دستی ساخته می‌شود چون ستون در دیتابیس default (cuid) ندارد —
--    به این ترتیب مهاجرت به default جدید جدول وابسته نیست.
INSERT INTO "Account" ("id", "code", "name", "type", "parentAccountId", "level", "isActive", "createdAt", "updatedAt")
SELECT
  substr(md5(random()::text || clock_timestamp()::text || s.code), 1, 24),
  s.code, s.name, s.type::"AccountType", p.id, 2, true, NOW(), NOW()
FROM (VALUES
  ('4000-01', 'برگشت از فروش (تخفیف و مرجوعی)', 'REVENUE', '4000'),
  ('4000-02', 'درآمد ارسال',                 'REVENUE', '4000'),
  ('4000-03', 'درآمد متفرقه',                'REVENUE', '4000'),
  ('5000-01', 'زیان ضایعات و انهدام',         'COGS',    '5000'),
  ('5000-02', 'زیان کسری انبارگردانی',       'COGS',    '5000'),
  ('5000-03', 'بهای تمام‌شده فروش',           'COGS',    '5000'),
  ('6000-01', 'هزینهٔ ارسال بار',            'EXPENSE', '6000'),
  ('6000-02', 'هزینهٔ بسته‌بندی',            'EXPENSE', '6000'),
  ('6000-03', 'کارمزد درگاه پرداخت',         'EXPENSE', '6000'),
  ('6000-04', 'حقوق و دستمزد',               'EXPENSE', '6000'),
  ('6000-05', 'اجاره و شارژ',                'EXPENSE', '6000'),
  ('6000-06', 'تبلیغات و بازاریابی',         'EXPENSE', '6000'),
  ('6000-07', 'اینترنت، برق و آب',           'EXPENSE', '6000'),
  ('6000-08', 'هزینهٔ برداشت و کارمزد بانکی', 'EXPENSE','6000'),
  ('6000-09', 'هزینه‌های عمومی و متفرقه',    'EXPENSE', '6000')
) AS s(code, name, type, parent_code)
JOIN "Account" p ON p.code = s.parent_code
ON CONFLICT ("code") DO UPDATE
  SET "name" = EXCLUDED."name",
      "type" = EXCLUDED."type",
      "level" = 2,
      "parentAccountId" = EXCLUDED."parentAccountId";

-- ── ۳) ایندکس برای گزارش درخت ──
CREATE INDEX IF NOT EXISTS "Account_parentAccountId_idx" ON "Account"("parentAccountId");
CREATE INDEX IF NOT EXISTS "Account_type_idx" ON "Account"("type");