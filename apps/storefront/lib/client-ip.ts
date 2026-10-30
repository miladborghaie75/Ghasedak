/**
 * IP واقعی کلاینت در پشت nginx.
 *
 * nginx با `$proxy_add_x_forwarded_for` مقدار واقعیِ اتصال را **آخر** فهرست
 * اضافه می‌کند؛ هر ورودیِ قبلی از خود کلاینت آمده و قابل جعل است. پس هرگز
 * `split(",")[0]` را به‌عنوان هویت کلاینت نگیر — با چرخاندن همین هدر می‌شود
 * محدودیت نرخ (و بودجهٔ چت هوش مصنوعی) را دور زد.
 */
export function clientIp(req: Request): string {
  const parts = (req.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.at(-1) ?? "unknown";
}

/** هدر آماده برای ارسال به API — فقط همان یک IP معتبر، نه زنجیرهٔ قابل جعل. */
export function clientIpHeaders(req: Request): Record<string, string> {
  const ip = clientIp(req);
  return ip === "unknown" ? {} : { "x-forwarded-for": ip };
}
