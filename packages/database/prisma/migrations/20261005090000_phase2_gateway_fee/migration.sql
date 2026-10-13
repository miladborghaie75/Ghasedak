-- گام ۳ فاز ۲ — کارمزد و تسویهٔ درگاه
--
-- چرا لازم است: سیستم فقط پرداخت آنی را پشتیبانی می‌کرد و کل مبلغ را در
-- بانک می‌نشاند. برای درگاه اعتباری این غلط است:
--   • پول تا چند هفته بعد نمی‌رسد
--   • کارمزد درگاه از مبلغ کسر می‌شود
-- پس دفتر باید هم تسویه را ببیند و هم کارمزد را (از جیب فروشگاه یا خریدار).

-- نوع enum باید **دستی** ساخته شود: Prisma در فایل migration خودش enum
-- نمی‌سازد (چون مهاجرت را به‌صورت SQL خام اجرا می‌کند).
DO $$ BEGIN
  CREATE TYPE "GatewayFeeBearer" AS ENUM ('MERCHANT', 'CUSTOMER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "PaymentProvider"
  ADD COLUMN IF NOT EXISTS "feePercentBps" INTEGER,
  ADD COLUMN IF NOT EXISTS "feeFlatToman" BIGINT,
  ADD COLUMN IF NOT EXISTS "feeBorneBy" "GatewayFeeBearer" NOT NULL DEFAULT 'MERCHANT',
  ADD COLUMN IF NOT EXISTS "settlementDays" INTEGER DEFAULT 1;

-- چرا ایندکس: گزارش «پرداخت‌های تسویه‌نشدهٔ قدیمی» روی همین ترکیب می‌کوبد
CREATE INDEX IF NOT EXISTS "PaymentProvider_feeBorneBy_idx" ON "PaymentProvider"("feeBorneBy");

-- قید دامنه: درصد کارمزد نمی‌تواند منفی یا غیرمنطقی باشد
ALTER TABLE "PaymentProvider" DROP CONSTRAINT IF EXISTS "PaymentProvider_feePercentBps_sane";
ALTER TABLE "PaymentProvider"
  ADD CONSTRAINT "PaymentProvider_feePercentBps_sane"
  CHECK ("feePercentBps" IS NULL OR ("feePercentBps" >= 0 AND "feePercentBps" <= 10000));

ALTER TABLE "PaymentProvider" DROP CONSTRAINT IF EXISTS "PaymentProvider_feeFlatToman_sane";
ALTER TABLE "PaymentProvider"
  ADD CONSTRAINT "PaymentProvider_feeFlatToman_sane"
  CHECK ("feeFlatToman" IS NULL OR "feeFlatToman" >= 0);