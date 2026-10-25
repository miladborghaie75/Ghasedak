import { emitAlert } from "./alert-bus";

/**
 * شمارندهٔ خطاهای ۵xx با پنجرهٔ لغزان (گام ۲۳ — بستهٔ C).
 *
 * در `HttpExceptionFilter` برای هر پاسخ ۵xx صدا زده می‌شود؛ اگر در ۵ دقیقهٔ
 * اخیر بیش از ۱۰ خطای ۵xx دیده باشیم، رویداد هشدار شلیک می‌شود (طوفان‌گریزی
 * در رأس هشدار است — هر نوع حداکثر یک‌بار در ۳۰ دقیقه).
 */
const WINDOW_MS = 5 * 60 * 1000;
const THRESHOLD = 10;

const hits: number[] = [];

/** ثبت یک خطای ۵xx — خروجی: تعداد خطاهای داخل پنجره (برای تست/لاگ) */
export function record5xx(now = Date.now()): number {
  hits.push(now);
  prune(now);
  if (hits.length > THRESHOLD) {
    emitAlert(
      "HTTP_5XX_SPIKE",
      `بیش از ${THRESHOLD} خطای ۵xx در ۵ دقیقهٔ اخیر (تعداد: ${hits.length}).`,
      { count: hits.length, windowMinutes: WINDOW_MS / 60_000 },
    );
  }
  return hits.length;
}

/** تعداد خطاهای پنجرهٔ فعلی — برای تست */
export function current5xxCount(now = Date.now()): number {
  prune(now);
  return hits.length;
}

/** فقط برای تست */
export function reset5xxForTests(): void {
  hits.length = 0;
}

function prune(now: number): void {
  const cutoff = now - WINDOW_MS;
  while (hits.length > 0 && hits[0] < cutoff) hits.shift();
}
