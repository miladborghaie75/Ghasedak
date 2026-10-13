-- گام ۷ فاز ۲ — حقوق خودکار
--
-- چرا جدول جدا: حقوق یک چیز تکرارشونده و ماهانه است، نه رویداد تک‌موردی.
-- اگر فقط سند دستی بود، سال بعد نمی‌شد «حقوق اسفند را با فروردین مقایسه کرد».

-- ── قرارداد حقوق هر کارکنان ──
CREATE TABLE IF NOT EXISTS "PayrollContract" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "baseSalary"   BIGINT NOT NULL DEFAULT 0,
  "housingAllowance" BIGINT NOT NULL DEFAULT 0,
  "childAllowance"    BIGINT NOT NULL DEFAULT 0,
  "transportAllowance" BIGINT NOT NULL DEFAULT 0,
  "otherAllowance"    BIGINT NOT NULL DEFAULT 0,
  "deduction"    BIGINT NOT NULL DEFAULT 0,
  "insuranceDeduction" BIGINT NOT NULL DEFAULT 0,
  "startDate"    TIMESTAMP(3) NOT NULL,
  "endDate"      TIMESTAMP(3),
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "note"         TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollContract_pkey" PRIMARY KEY ("id")
);

-- یک قرارداد فعال برای هر کارمند
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollContract_one_active_per_user"
  ON "PayrollContract" ("userId") WHERE "active" = true;

-- ── لیست حقوق هر ماه ──
-- نوع enum باید **دستی** ساخته شود (Prisma در SQL خام enum نمی‌سازد).
DO $$ BEGIN
  CREATE TYPE "PayrollState" AS ENUM ('DRAFT', 'POSTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PayrollRun" (
  "id"        TEXT NOT NULL,
  "period"    TEXT NOT NULL,                  -- مثال: 1404/05
  "title"     TEXT NOT NULL,
  "state"     "PayrollState" NOT NULL DEFAULT 'DRAFT',
  "totalGross" BIGINT NOT NULL DEFAULT 0,
  "totalDeduction" BIGINT NOT NULL DEFAULT 0,
  "totalNet"  BIGINT NOT NULL DEFAULT 0,
  "journalEntryId" TEXT,
  "postedAt"  TIMESTAMP(3),
  "postedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- یک لیست حقوق برای هر ماه
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_period_key" ON "PayrollRun" ("period");

-- اگر جدول از قبل با `state` از نوع text ساخته شده بود (نصب نیمه‌کاره)،
-- به enum واقعی تبدیلش می‌کنیم — وگرنه Prisma در `create` خطای ناشناخته می‌دهد.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'PayrollRun' AND column_name = 'state' AND data_type = 'text'
  ) THEN
    ALTER TABLE "PayrollRun"
      ALTER COLUMN "state" DROP DEFAULT,
      ALTER COLUMN "state" TYPE "PayrollState"
      USING ("state"::"PayrollState");
    ALTER TABLE "PayrollRun" ALTER COLUMN "state" SET DEFAULT 'DRAFT';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PayrollItem" (
  "id"          TEXT NOT NULL,
  "runId"       TEXT NOT NULL,
  "userId"      TEXT NOT NULL,
  "period"      TEXT NOT NULL,
  "gross"       BIGINT NOT NULL DEFAULT 0,
  "deduction"   BIGINT NOT NULL DEFAULT 0,
  "net"         BIGINT NOT NULL DEFAULT 0,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollItem_net_check" CHECK ("net" = "gross" - "deduction")
);

CREATE INDEX IF NOT EXISTS "PayrollItem_runId_idx" ON "PayrollItem" ("runId");

-- جلوگیری از پرداخت دوبارهٔ حقوق یک ماه
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollItem_one_per_user_month"
  ON "PayrollItem" ("userId", "period");

-- سند حقوق نباید به دو لیست وصل شود
CREATE UNIQUE INDEX IF NOT EXISTS "PayrollRun_journalEntry_key"
  ON "PayrollRun" ("journalEntryId") WHERE "journalEntryId" IS NOT NULL;

-- کلیدهای خارجی (با DROP اول تا روی نصب نیمه‌کاره هم امن باشد)
ALTER TABLE "PayrollItem" DROP CONSTRAINT IF EXISTS "PayrollItem_runId_fkey";
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE;

ALTER TABLE "PayrollContract" DROP CONSTRAINT IF EXISTS "PayrollContract_userId_fkey";
ALTER TABLE "PayrollContract" ADD CONSTRAINT "PayrollContract_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE;

-- ── حساب حقوق پرداختنی کارکنان (۲۱۰۱) ──
-- جدا از `2100` (بدهی تأمین‌کننده) تا گزارش بدهی‌ها قابل تفکیک باشد.
-- اگر قاطی شوند، نمی‌شود فهمید فروشگاه چقدر به تأمین‌کننده و چقدر به
-- کارمند بدهکار است.
INSERT INTO "Account" ("id", "code", "name", "type", "parentAccountId", "level", "isActive", "createdAt", "updatedAt")
VALUES (
  substr(md5(random()::text || clock_timestamp()::text || 'salary-payable'), 1, 24),
  '2101', 'حقوق و مزایای پرداختنی کارکنان', 'LIABILITY', NULL, 1, true, NOW(), NOW()
)
ON CONFLICT ("code") DO NOTHING;