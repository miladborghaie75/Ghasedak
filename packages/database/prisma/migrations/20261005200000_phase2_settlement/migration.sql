-- فاز ۲٫۵ — چرخهٔ تسویهٔ درگاه
--
-- مسئله‌ای که این حل می‌کند: برای درگاه اعتباری، پولِ مشتری **همان لحظه**
-- به حساب فروشگاه نمی‌رسد. چند هفته بعد، و کمتر از کل مبلغ، چون سهم
-- درگاه کسر می‌شود.
--
-- اگر کل مبلغ را در همان سند فروش به حساب بانک ببریم (کاری که سیستم الان
-- می‌کند)، آن‌وقت دو اتفاق بد می‌افتد:
--   ۱) موجودی بانک در دفتر بیشتر از واقعیت نشان داده می‌شود
--   ۲) درآمد فروش بیش از واقعیت به نظر می‌رسد (چون کارمزد دیده نشده)
--
-- راه‌حل استاندارد: پول اول در حساب «طلب از درگاه» بنشیند (هنوز مال ما نیست)،
-- و وقتی گزارش تسویه رسید، از آن حساب به بانک منتقل شود و کارمزد کسر شود.

-- ── حساب طلب از درگاه (۱۲۵۰) ──
-- داراییی است چون پول نزد درگاه هنوز طلبِ ماست و از کف دارایی‌ها خارج نمی‌شود.
INSERT INTO "Account" ("id", "code", "name", "type", "parentAccountId", "level", "isActive", "createdAt", "updatedAt")
VALUES (
  substr(md5(random()::text || clock_timestamp()::text || 'gateway-receivable'), 1, 24),
  '1250', 'طلب از درگاه پرداخت (پول نزد درگاه، تسویه‌نشده)', 'ASSET', NULL, 1, true, NOW(), NOW()
)
ON CONFLICT ("code") DO NOTHING;

-- ── بستهٔ تسویه: یک گزارش تسویه از یک درگاه ──
-- یک درگاه ممکن است ده‌ها پرداخت را در یک گزارش تسویه کند، پس «بسته»
-- لازم است تا برای کل گزارش **یک** سند زده شود، نه یک سند به‌ازای
-- هر خرید — وگرنه دفتر پر از سندهای ریز و غیرقابل‌بررسی می‌شد.
--
-- نکتهٔ مهم دربارهٔ `id`: در این دیتابیس ستون id روی بیشتر جداول
-- دستی ساخته شده (بدون default از نوع cuid). پس `id` را خودمان می‌سازیم؛
-- اگر به پریسم واگذاری شود، خطای «null value violates not-null» می‌دهد.
--
-- enum هم باید **دستی** ساخته شود — Prisma در فایل migration خودش enum
-- نمی‌سازد. بدون این، خطای «type does not exist» می‌گیریم (همان اشتباهی که
-- در جدول حقوق پیش آمد).
DO $$ BEGIN
  CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'POSTED', 'VOID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "SettlementBatch" (
  "id"             TEXT NOT NULL,
  "providerId"     TEXT NOT NULL,
  "reference"      TEXT NOT NULL,               -- شمارهٔ گزارش درگاه (یکتا)
  "settlementDate" TIMESTAMP(3) NOT NULL,
  "grossAmount"    BIGINT NOT NULL DEFAULT 0,   -- جمع کل پرداخت‌های تسویه‌شده
  "feeAmount"      BIGINT NOT NULL DEFAULT 0,   -- کارمزد درگاه
  "netAmount"      BIGINT NOT NULL DEFAULT 0,   -- آنچه واقعاً به حساب ما آمد
  "status"         TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING|POSTED|VOID
  "journalEntryId" TEXT,
  "postedAt"       TIMESTAMP(3),
  "postedById"     TEXT,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SettlementBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SettlementBatch_status_check" CHECK ("status" IN ('PENDING','POSTED','VOID')),
  -- نرخ‌ها نمی‌توانند منفی باشند
  CONSTRAINT "SettlementBatch_non_negative"
    CHECK ("grossAmount" >= 0 AND "feeAmount" >= 0 AND "netAmount" >= 0),
  -- کارمزد نمی‌تواند از کل بیشتر باشد (وگرنه پولی از هیچ می‌آمد)
  CONSTRAINT "SettlementBatch_fee_sane" CHECK ("feeAmount" <= "grossAmount")
);

-- یک گزارش تسویه نباید دوبار ثبت شود
CREATE UNIQUE INDEX IF NOT EXISTS "SettlementBatch_provider_reference_key"
  ON "SettlementBatch" ("providerId", "reference");

-- سند نباید به دو بسته وصل شود (پول دوباره وارد نشود)
CREATE UNIQUE INDEX IF NOT EXISTS "SettlementBatch_journalEntry_key"
  ON "SettlementBatch" ("journalEntryId") WHERE "journalEntryId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "SettlementBatch_status_idx" ON "SettlementBatch" ("status");

ALTER TABLE "SettlementBatch" DROP CONSTRAINT IF EXISTS "SettlementBatch_providerId_fkey";
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "PaymentProvider"("id") ON DELETE CASCADE;

ALTER TABLE "SettlementBatch" DROP CONSTRAINT IF EXISTS "SettlementBatch_journalEntryId_fkey";
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL;

ALTER TABLE "SettlementBatch" DROP CONSTRAINT IF EXISTS "SettlementBatch_postedById_fkey";
ALTER TABLE "SettlementBatch" ADD CONSTRAINT "SettlementBatch_postedById_fkey"
  FOREIGN KEY ("postedById") REFERENCES "User"("id") ON DELETE SET NULL;

-- ── پیوند هر پرداخت به بستهٔ تسویه‌اش ──
-- تا گزارش «پرداخت‌های تسویه‌نشده» قابل ساخت باشد و تطبیق خودکار انجام شود.
ALTER TABLE "PaymentAttempt" ADD COLUMN IF NOT EXISTS "settlementBatchId" TEXT;

ALTER TABLE "PaymentAttempt" DROP CONSTRAINT IF EXISTS "PaymentAttempt_settlementBatchId_fkey";
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_settlementBatchId_fkey"
  FOREIGN KEY ("settlementBatchId") REFERENCES "SettlementBatch"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "PaymentAttempt_settlementBatchId_idx" ON "PaymentAttempt"("settlementBatchId");

-- نکته: یکتاییِ «هر پرداخت فقط در یک بسته» لازم نیست — هر پرداخت ذاتاً یک
-- `settlementBatchId` دارد، پس دوبار در دو بسته نمی‌نشیند. ایندکس یکتای
-- جزئی لازم نیست و قبلاً به ستونی اشاره می‌کرد که وجود ندارد
-- (`refId` روی `PaymentAttempt` نیست). اینجا فقط شاخصِ معمولی می‌سازیم.