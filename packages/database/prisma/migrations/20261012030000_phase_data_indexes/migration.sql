-- ایندکسهای داده‌ای (فاز ۲ — B1) — افزایشی و بدون تغییر داده
-- OrderItem: پیوند به واریانت (گزارشها و محور واریانت)
CREATE INDEX IF NOT EXISTS "OrderItem_variantId_idx" ON "OrderItem"("variantId");

-- ReturnRequest: فهرست/فیلتر بر اساس وضعیت + زمان (پیش‌تر هیچ ایندکسی نداشت)
CREATE INDEX IF NOT EXISTS "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");
