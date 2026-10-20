-- گام ۱۵-۶ (D-6) — dedupe بازدید صفحه: هر (روز، نشست، مسیر) در پنجرهٔ ۳۰ دقیقه
-- فقط یک‌بار views را بالا می‌برد؛ F5 و برگشت سریع شمرده نمی‌شوند.
CREATE TABLE "DailyVisitPath" (
    "day" TIMESTAMP(3) NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyVisitPath_pkey" PRIMARY KEY ("day","sessionKey","path")
);

-- پاک‌سازی دوره‌ای ردیف‌های قدیمی به‌جای ایندکس اضافه؛ فقط روز برای sweep لازم است
CREATE INDEX "DailyVisitPath_day_idx" ON "DailyVisitPath"("day");
