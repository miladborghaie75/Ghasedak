-- Phase 9 — Check / BankStatementMatch / CheckTransition (Audit + Reconciliation Design Gate)
-- منبع طراحی: schema diff تأییدشده در Design Gate (779b7a2 working tree) — بدون lifecycle service (Wave 2).
-- قواعد: هیچ عملیات destructive نیست؛ همهٔ مقادیر NOT NULL با default اضافه می‌شوند؛ FKها Restrict/SetNull مطابق relationهای Prisma.

-- CreateEnum
CREATE TYPE "BankStatementMatchState" AS ENUM ('MANUAL_REVIEW', 'MATCHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ArExposureType" AS ENUM ('TRADE', 'CHECK');

-- AlterTable: Check extensions (فاز ۹)
ALTER TABLE "Check" ADD COLUMN "customerId" TEXT;
ALTER TABLE "Check" ADD COLUMN "supplierId" TEXT;
ALTER TABLE "Check" ADD COLUMN "accountsReceivableId" TEXT;
ALTER TABLE "Check" ADD COLUMN "treasuryBankAccountId" TEXT;
ALTER TABLE "Check" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "Check" ADD COLUMN "lifecycleVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable: PosPayment.checkId — ستون در baseline وجود دارد؛ اینجا فقط UNIQUE می‌شود (1:1 با چک — فاز ۹)
CREATE UNIQUE INDEX "PosPayment_checkId_key" ON "PosPayment"("checkId");

-- AlterTable: PurchasePayment.checkId + idempotencyKey (پرداخت خرید چکی — بدون برداشت فوری بانک)
ALTER TABLE "PurchasePayment" ADD COLUMN "idempotencyKey" TEXT;

-- AlterTable: PaymentSettlement.checkId
ALTER TABLE "PaymentSettlement" ADD COLUMN "checkId" TEXT;

-- AlterTable: AccountsReceivable.exposureType (TRADE = رفتار فعلی، CHECK = exposure چکی)
ALTER TABLE "AccountsReceivable" ADD COLUMN "exposureType" "ArExposureType" NOT NULL DEFAULT 'TRADE';

-- AlterTable: Reminder.idempotencyKey (ضدتکرار scheduler فاز ۹ — اجرای بعدی)
ALTER TABLE "Reminder" ADD COLUMN "idempotencyKey" TEXT;

-- CreateTable: BankStatementMatch — تطبیق/تخصیص reconciliation بانک
-- اصل بند ۱۴ Design Gate: تطبیق هرگز به‌تنهایی Check را clear نمی‌کند (صرفاً evidence است).
CREATE TABLE "BankStatementMatch" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "allocatedAmount" BIGINT NOT NULL DEFAULT 0,
    "state" "BankStatementMatchState" NOT NULL DEFAULT 'MANUAL_REVIEW',
    "note" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "checkId" TEXT,

    CONSTRAINT "BankStatementMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CheckTransition — CAS + audit trail + idempotency برای lifecycle فاز ۹ (اجرا در Wave 2)
CREATE TABLE "CheckTransition" (
    "id" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fromStatus" "CheckStatus",
    "toStatus" "CheckStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" TEXT,
    "reason" TEXT,
    "requestId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckTransition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Check_idempotencyKey_key" ON "Check"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Check_customerId_dueDate_idx" ON "Check"("customerId", "dueDate");

-- CreateIndex
CREATE INDEX "Check_supplierId_dueDate_idx" ON "Check"("supplierId", "dueDate");

-- CreateIndex
CREATE INDEX "Check_sourceType_sourceId_idx" ON "Check"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePayment_checkId_key" ON "PurchasePayment"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchasePayment_idempotencyKey_key" ON "PurchasePayment"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentSettlement_checkId_key" ON "PaymentSettlement"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_idempotencyKey_key" ON "Reminder"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BankStatementMatch_statementId_sourceType_sourceId_key" ON "BankStatementMatch"("statementId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "BankStatementMatch_sourceType_sourceId_state_idx" ON "BankStatementMatch"("sourceType", "sourceId", "state");

-- CreateIndex
CREATE INDEX "BankStatementMatch_statementId_state_idx" ON "BankStatementMatch"("statementId", "state");

-- CreateIndex
CREATE INDEX "BankStatementMatch_checkId_idx" ON "BankStatementMatch"("checkId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckTransition_checkId_version_key" ON "CheckTransition"("checkId", "version");

-- CreateIndex
CREATE INDEX "CheckTransition_checkId_createdAt_idx" ON "CheckTransition"("checkId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckTransition_idempotencyKey_key" ON "CheckTransition"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AccountsReceivable_accountPId_exposureType_state_idx" ON "AccountsReceivable"("accountPId", "exposureType", "state");

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_accountsReceivableId_fkey" FOREIGN KEY ("accountsReceivableId") REFERENCES "AccountsReceivable"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Check" ADD CONSTRAINT "Check_treasuryBankAccountId_fkey" FOREIGN KEY ("treasuryBankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PosPayment" ADD CONSTRAINT "PosPayment_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchasePayment" ADD CONSTRAINT "PurchasePayment_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentSettlement" ADD CONSTRAINT "PaymentSettlement_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankStatementMatch" ADD CONSTRAINT "BankStatementMatch_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckTransition" ADD CONSTRAINT "CheckTransition_checkId_fkey" FOREIGN KEY ("checkId") REFERENCES "Check"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckTransition" ADD CONSTRAINT "CheckTransition_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
