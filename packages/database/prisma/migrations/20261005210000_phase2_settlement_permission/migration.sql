-- فاز ۲٫۵ — مجوز `payments.manage`
--
-- چرا لازم است: endpointهای تسویه (`POST /admin/settlements`, `/post`, `/void`)
-- به مجوزی نیاز داشتند که در سیستم نبود. نتیجه: هیچ نقشی جز مدیر ارشد
-- (که `*` دارد) نمی‌توانست تسویه ثبت کند — قابلیت روی کاغذ ساخته شده بود
-- ولی در عمل غیرقابل استفاده.
--
-- ساختار مجوزها در این پروژه جدول جدا ندارد:
--   Permission { id, key }  و  RolePermission { role (enum), permissionKey }
-- پس upsert باید روی `key` و روی جفت `(role, permissionKey)` باشد.

INSERT INTO "Permission" ("id", "key")
VALUES (gen_random_uuid()::text, 'payments.manage')
ON CONFLICT ("key") DO NOTHING;

-- تفکیک از `payments.reconcile` عمدی است:
--   reconcile = تطبیق و بررسی (فقط دیدن گزارش و مغایرت)
--   manage    = تغییر وضعیت مالی (ثبت سند تسویه، باطل‌کردن بسته)
-- کسی که فقط می‌خواهد ببیند پول کجاست نباید بتواند سند بزند.

-- حسابدار: وظیفه‌اش تطبیق و ثبت تسویه است
INSERT INTO "RolePermission" ("id", "role", "permissionKey")
VALUES (gen_random_uuid()::text, 'ACCOUNTANT', 'payments.manage')
ON CONFLICT ("role", "permissionKey") DO NOTHING;

-- مدیر ارشد: همهٔ مجوزها را **صریح** می‌گیرد (`ROLE_SETS.SUPER_ADMIN = PERMISSIONS`)
-- و ستون `*` ندارد — پس باید همین مجوز صریح برایش ساخته شود، وگرنه
-- گاردِ `permissions.includes("*")` هرگز true نمی‌شود.
INSERT INTO "RolePermission" ("id", "role", "permissionKey")
VALUES (gen_random_uuid()::text, 'SUPER_ADMIN', 'payments.manage')
ON CONFLICT ("role", "permissionKey") DO NOTHING;

-- مدیر فروشگاه: صندوق و درگاه در حوزهٔ اوست
INSERT INTO "RolePermission" ("id", "role", "permissionKey")
VALUES (gen_random_uuid()::text, 'STORE_MANAGER', 'payments.manage')
ON CONFLICT ("role", "permissionKey") DO NOTHING;