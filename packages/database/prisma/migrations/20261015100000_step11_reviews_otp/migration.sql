-- گام ۱۱ (ماژول نظرات): جدول کد یک‌بارمصرف تأیید موبایل مهمان.
-- فقط جدول جدید — هیچ تغییر مخربی روی جداول موجود نیست.
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'review',
    "token" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OtpCode_mobile_createdAt_idx" ON "OtpCode"("mobile", "createdAt");
CREATE INDEX "OtpCode_token_idx" ON "OtpCode"("token");
