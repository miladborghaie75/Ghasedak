import { BadRequestException } from "@nestjs/common";

/**
 * گام F0-5 (P1-1) — allowlist آدرس بازگشت درگاه.
 *
 * مسئله: `POST /api/v1/payments/start` آدرس بازگشتی را از بدنهٔ درخواست
 * می‌گرفت و بدون هیچ بررسی به درگاه می‌داد (`callback_url` زرین‌پال /
 * redirect mock). یعنی هر کسی می‌توانست برای یک سفارش، بازگشت پرداخت را به
 * دامنهٔ خودش بچسباند: مشتری بعد از پرداخت واقعی به صفحهٔ جعلی «پرداخت
 * موفق» هدایت می‌شود (فیشینگ) — و همین آدرس در پنل درگاه به‌عنوان
 * Callback ثبت/استفاده می‌شود.
 *
 * راه‌حل: allowlist صریح. هر آدرسی که می‌رسد باید یا **نسبی** باشد (روی
 * دامنهٔ مجاز resolve می‌شود) یا مطلق با origin دقیقاً در فهرست مجاز.
 * هیچ «نسبی‌سازی بی‌صدا»یی نداریم: دامنهٔ بیرونی با پیام روشن رد می‌شود.
 *
 * پیکربندی (به ترتیب اولویت):
 *   ۱. `PAYMENT_CALLBACK_ORIGINS` — فهرست جدا‌شده با کاما (مثلاً در production
 *      فقط `https://www.lebaszirghasedak.ir`)
 *   ۲. `CORS_ORIGINS` — همان دامنه‌های مجاز اپلیکیشن (پیش‌فرض در dev)
 * اگر هیچ‌کدام تنظیم نشده باشد، **پرداخت آغاز نمی‌شود** (خطای روشن) — چون
 * «نمی‌توانم بررسی کنم» هرگز نباید به «پس بگذار رد شود» ترجمه شود.
 */

/** مسیر پیش‌فرض بازگشت وقتی فراخوان آدرسی نداده باشد */
export const DEFAULT_CALLBACK_PATH = "/api/pay/callback";

/** origin های مجاز — از env قابل تزریق برای تست */
export function allowedCallbackOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  return normalizeOrigins(env.PAYMENT_CALLBACK_ORIGINS ?? env.CORS_ORIGINS ?? "");
}

/** «scheme://host[:port]» بدون مسیر؛ ورودی نامعتبر حذف می‌شود */
export function normalizeOrigins(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const t = part.trim();
    if (!t) continue;
    try {
      const u = new URL(t);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      if (!out.includes(u.origin)) out.push(u.origin);
    } catch {
      /* ورودی نامعتبر (مثل `lebaszirghasedak.ir` بدون scheme) نادیده می‌رود */
    }
  }
  return out;
}

/** خطای رد آدرس — مقدار رد‌شده عمداً بازتاب نمی‌یابد (بند ۶۵) */
function notAllowed(allowed: string[]): BadRequestException {
  return new BadRequestException({
    code: "CALLBACK_URL_NOT_ALLOWED",
    message: "آدرس بازگشت پرداخت خارج از دامنه‌های مجاز است.",
    fieldErrors: { callbackUrl: [`دامنهٔ مجاز: ${allowed.join(", ")}`] },
  });
}

/**
 * بررسی و نرمال‌سازی آدرس بازگشت.
 * - خالی → پیش‌فرض روی اولین دامنهٔ مجاز
 * - نسبی (`/api/pay/callback`) → روی اولین دامنهٔ مجاز resolve
 * - مطلق → فقط اگر origin در فهرست مجاز باشد
 */
export function resolveCallbackUrl(input: string | null | undefined, env: NodeJS.ProcessEnv = process.env): string {
  const allowed = allowedCallbackOrigins(env);
  if (allowed.length === 0) {
    throw new BadRequestException({
      code: "CALLBACK_ORIGIN_UNCONFIGURED",
      message: "دامنهٔ مجاز بازگشت پرداخت تنظیم نشده است (PAYMENT_CALLBACK_ORIGINS) — تا تنظیم نشدن، پرداخت آغاز نمی‌شود.",
    });
  }
  const raw = (input ?? "").trim();
  if (!raw) return new URL(DEFAULT_CALLBACK_PATH, allowed[0]).toString();
  // `//evil.example/cb` پروتکل-نسبی است و به دامنهٔ بیرونی می‌رود
  if (raw.startsWith("//")) throw notAllowed(allowed);
  if (raw.startsWith("/")) return new URL(raw, allowed[0]).toString();

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw notAllowed(allowed);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw notAllowed(allowed);
  if (!allowed.includes(parsed.origin)) throw notAllowed(allowed);
  return parsed.toString();
}
