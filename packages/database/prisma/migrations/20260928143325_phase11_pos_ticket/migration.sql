-- CreateTable
CREATE TABLE "PosTicket" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "shiftId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "customerMobile" TEXT,
    "customerName" TEXT,
    "items" JSONB NOT NULL,
    "discountTotal" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "audit" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PosTicket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PosTicket_status_userId_idx" ON "PosTicket"("status", "userId");

-- CreateIndex
CREATE INDEX "PosTicket_shiftId_idx" ON "PosTicket"("shiftId");

-- AlterTable — فاز ۱۱ (P2-B): وضعیت dispatch برای Notification
ALTER TABLE "Notification" ADD COLUMN "lastError" TEXT;
ALTER TABLE "Notification" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
