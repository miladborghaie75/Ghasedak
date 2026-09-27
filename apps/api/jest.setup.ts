import "reflect-metadata";

/**
 * گارد DB برای تست‌ها — هرگز اجازه فرود اشتباهی روی Production را نمی‌دهد.
 *
 * سابقه: مقدار پیش‌فرض قبلی روی DATABASE_URL پروDUCTION (5433/ghasedak) بود؛
 * یک اجرای full-suite بدون env صریح، داده تست را روی Production ریخت.
 * از این پس: اگر DATABASE_URL ست نشده باشد، تست‌ها fail-fast می‌کنند —
 * هیچ fallback‌ای وجود ندارد؛ فقط URL صریحِ rehearsal/isolated.
 */
if (!process.env.DATABASE_URL) {
  throw new Error(
    "[jest.setup] DATABASE_URL ست نشده است. برای جلوگیری از نشست تست روی DB اشتباه، " +
      'صریحاً اجرا کنید: DATABASE_URL="postgresql://postgres:<pw>@127.0.0.1:<port>/<rehearsal-db>" — ' +
      "fallback پیش‌فرض ممنوع است (Production هرگز پیش‌فرض نیست).",
  );
}
if (/5433\/ghasedak(\?|$)/.test(process.env.DATABASE_URL)) {
  throw new Error(
    "[jest.setup] DATABASE_URL به Production (5433/ghasedak) اشاره می‌کند — تست روی Production ممنوع است.",
  );
}
