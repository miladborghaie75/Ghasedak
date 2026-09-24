-- AddIdempotencyKeyToOrder — جلوگیری از سفارش تکراری (بند ۱۱۶)
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
