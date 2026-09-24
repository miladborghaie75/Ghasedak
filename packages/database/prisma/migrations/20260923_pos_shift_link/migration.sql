ALTER TABLE "PosInvoice" ADD COLUMN "shiftId" TEXT;
CREATE INDEX "PosInvoice_shiftId_idx" ON "PosInvoice"("shiftId");
ALTER TABLE "PosInvoice" ADD CONSTRAINT "PosInvoice_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "CashierShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
