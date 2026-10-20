-- گام ۱۵-۶ — آمار بازدید روزانهٔ فروشگاه (first-party، فقط با رضایت ANALYTICS)
-- «روز» به وقت تهران است؛ آفست ایران ثابت +۳:۳۰ است و مرز روز به‌صورت UTC ذخیره می‌شود.

CREATE TABLE "DailyVisit" (
    "day" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyVisit_pkey" PRIMARY KEY ("day")
);

CREATE TABLE "DailyVisitSession" (
    "day" TIMESTAMP(3) NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyVisitSession_pkey" PRIMARY KEY ("day", "sessionKey")
);

CREATE INDEX "DailyVisitSession_sessionKey_idx" ON "DailyVisitSession"("sessionKey");
