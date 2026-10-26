-- Step 23 (AI): مصرف روزانهٔ AI به تفکیک قابلیت — کنار هم قرار دادنِ هزینهٔ ارائه‌دهنده بین قابلیت‌ها
CREATE TABLE "AiUsageDay" (
    "day" TIMESTAMP(3) NOT NULL,
    "capability" TEXT NOT NULL,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsageDay_pkey" PRIMARY KEY ("day", "capability")
);
