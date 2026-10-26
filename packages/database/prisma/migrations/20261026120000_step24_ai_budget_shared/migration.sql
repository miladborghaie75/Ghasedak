-- Step 24 (AI، بخش ۱): زیرساخت سهمیه و اعتماد شبکه — ذخیره‌ساز مشترک بین چند نمونهٔ API
--
-- محتوا:
--   1) AiUsageDay.reservedRequests — رزروهای در جریان (رزرو اتمیک پیش از تماس پولی،
--      تسویه با مصرف واقعی؛ رزرو ناموفق با release آزاد می‌شود).
--   2) AiUserDay — سقف روزانهٔ هر کاربر/نشست در ذخیره‌ساز مشترک (کلید = هش SHA-256؛
--      هیچ IP خام یا شناسهٔ کاربر ذخیره نمی‌شود).
--   3) RateLimitWindow — پنجره‌های rate limit مشترک (کلید = هش SHA-256 قانون + کلاینت).
--
-- migration کاملاً additive است؛ روی دادهٔ موجود چیزی نمی‌نویسد و ستون پیش‌فرض ۰ دارد.
-- بازگشت (فقط در فوریت — مصرف امروز AI از دست می‌رود):
--   ALTER TABLE "AiUsageDay" DROP COLUMN IF EXISTS "reservedRequests";
--   DROP TABLE IF EXISTS "AiUserDay";
--   DROP TABLE IF EXISTS "RateLimitWindow";

ALTER TABLE "AiUsageDay" ADD COLUMN "reservedRequests" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "AiUserDay" (
    "day" TIMESTAMP(3) NOT NULL,
    "userKeyHash" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUserDay_pkey" PRIMARY KEY ("day","userKeyHash")
);

CREATE INDEX "AiUserDay_day_idx" ON "AiUserDay"("day");

CREATE TABLE "RateLimitWindow" (
    "windowKey" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitWindow_pkey" PRIMARY KEY ("windowKey","windowStart")
);

CREATE INDEX "RateLimitWindow_windowStart_idx" ON "RateLimitWindow"("windowStart");
