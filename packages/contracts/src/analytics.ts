/**
 * فیلتر بات برای شمارش بازدید (گام ۱۵-۶، تصمیم D-6) — منبع واحد برای
 * هر دو لایه: پراکسی فروشگاه (کاهش بار) و API (مرز نهایی حقیقت).
 * خوانندهٔ پیش‌نمایش Freebuff/Electron عمداً اینجا نیست تا بات شمرده نشود.
 * لیست محافظه‌کار است — فقط خزنده‌های معروف و ابزارهای تست؛ UA خالی
 * (فراخوانی داخلی/تست) هرگز بات فرض نمی‌شود.
 */
export const BOT_UA_PATTERN =
  "bot|crawl|spider|slurp|bingpreview|facebookexternalhit|twitterbot|telegrambot|whatsapp|linkedinbot|pinterestbot|curl|wget|python-requests|python-urllib|go-http-client|okhttp|httpx|scrapy|apache-httpclient|java/|lighthouse|puppeteer|phantomjs|selenium|gtmetrix|uptime|pingdom|headlesschrome";

const BOT_UA = new RegExp(BOT_UA_PATTERN, "i");

/** true یعنی این درخواست خزنده/ابزار است و بازدیدش شمرده نمی‌شود */
export function isBotUa(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BOT_UA.test(ua);
}
