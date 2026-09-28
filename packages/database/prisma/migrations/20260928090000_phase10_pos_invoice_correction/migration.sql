-- Phase 10 — PosInvoice correction workflow (controlled, traced)
-- FINALIZED invoices are never overwritten; each correction is a new revision
-- referencing its source invoice. Fully additive, non-destructive.

ALTER TABLE "PosInvoice" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "PosInvoice" ADD COLUMN "correctsId" TEXT;

ALTER TABLE "PosInvoice" ADD CONSTRAINT "PosInvoice_correctsId_fkey"
  FOREIGN KEY ("correctsId") REFERENCES "PosInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PosInvoice_correctsId_idx" ON "PosInvoice"("correctsId");
