-- گام ۱۵ (تصمیم D-4) — UTM first-touch روی سفارش
ALTER TABLE "Order" ADD COLUMN "utmSnapshot" JSONB;
