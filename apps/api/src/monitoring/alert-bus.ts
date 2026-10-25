import { Logger } from "@nestjs/common";

/**
 * رأس هشدار (گام ۲۳ — بستهٔ C): یک رابطِ سطح-ماژول بین «محل‌های رویداد» و
 * «ارسال‌کنندهٔ واقعی» (تلگرام/ایمیل در AlertingService).
 *
 * چرا ماژول سطح-سطح و نه تزریق وابستگی: filter خطاها، workerهای تایمردار و
 * سرویس پرداخت جاهای پراکنده‌اند (بعضی خارج از DI ساخته می‌شوند). با این رابط،
 * هر جا `emitAlert(...)` صدا زده شود — اگر سرویس هشدار پیوسته باشد ارسال واقعی
 * می‌شود، وگرنه فقط لاگ ساخت‌یافتهٔ dry-run ثبت می‌شود (در تست/توسعه هرگز ارسال واقعی نیست).
 *
 * طوفان‌گریز: هر kind حداکثر یک‌بار در پنجرهٔ `ALERT_WINDOW_MS` عبور می‌کند؛
 * موارد سرکوب‌شده هم با لاگ ساخت‌یافته دیده می‌شوند (بی‌صدا گم نمی‌شوند).
 */

export type AlertKind =
  | "HEALTH_DOWN"
  | "HTTP_5XX_SPIKE"
  | "BACKUP_FAILED"
  | "DISK_HIGH"
  | "WORKER_ERROR"
  | "PAYMENT_MISMATCH";

export interface AlertPayload {
  kind: AlertKind;
  message: string;
  detail?: Record<string, unknown>;
}

/** پنجرهٔ طوفان‌گریز — یک هشدار از هر نوع حداکثر هر ۳۰ دقیقه */
export const ALERT_WINDOW_MS = 30 * 60 * 1000;

type AlertListener = (p: AlertPayload) => void;

const listeners = new Set<AlertListener>();
const lastSentAt = new Map<AlertKind, number>();
const logger = new Logger("Alerting");

/** ثبت ارسال‌کننده — AlertingService هنگام بوت می‌آید؛ برگرداندن تابع لغو ثبت */
export function onAlert(fn: AlertListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** فقط برای تست — پنجرهٔ طوفان‌گریز را ریست می‌کند */
export function resetAlertBusForTests(): void {
  lastSentAt.clear();
  listeners.clear();
}

/**
 * اعلام رویداد هشدار. `true` یعنی از پنجرهٔ طوفان‌گریز گذشت و به شنونده‌ها رسید؛
 * `false` یعنی در پنجره سرکوب شد (لاگ ساخت‌یافته ثبت می‌شود).
 */
export function emitAlert(kind: AlertKind, message: string, detail?: Record<string, unknown>): boolean {
  const now = Date.now();
  const last = lastSentAt.get(kind) ?? 0;
  if (now - last < ALERT_WINDOW_MS) {
    logger.warn(
      JSON.stringify({ component: "alerting", status: "SUPPRESSED", kind, windowMs: ALERT_WINDOW_MS, message }),
    );
    return false;
  }
  lastSentAt.set(kind, now);
  const payload: AlertPayload = { kind, message, ...(detail ? { detail } : {}) };
  if (listeners.size === 0) {
    // بدون ارسال‌کننده (تست/توسعه بدون env): dry-run — فقط لاگ ساخت‌یافته، هیچ شبکه‌ای در کار نیست
    logger.warn(JSON.stringify({ component: "alerting", status: "DRY_RUN", kind, message, detail: detail ?? {} }));
    return true;
  }
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch (e) {
      logger.error(`listener خطا داد: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return true;
}
