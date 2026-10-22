-- گام ۱۷-۲: جداکردن «پیش‌نویس» از «منتشرشده» در صفحه‌ساز.
--
-- چرا: پیش از این تنها یک ستون payload بود، پس ذخیرهٔ یک صفحهٔ منتشرشده
-- بی‌درنگ همان چیزی می‌شد که مشتری می‌دید و دکمهٔ «انتشار» عملاً کاری نمی‌کرد.
-- اکنون payload = پیش‌نویس و publishedPayload = اسنپ‌شات منتشرشده.

ALTER TABLE "CmsPage" ADD COLUMN "publishedPayload" JSONB;

-- صفحه‌هایی که از قبل PUBLISHED هستند، اسنپ‌شات‌شان همان محتوای فعلی است
-- (تا رفتارشان عوض نشود و اولین ذخیره بعدی، سایت را بی‌خبر تغییر ندهد).
UPDATE "CmsPage"
SET "publishedPayload" = "payload"
WHERE "status" = 'PUBLISHED';
