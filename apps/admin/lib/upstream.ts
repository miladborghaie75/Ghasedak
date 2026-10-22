/**
 * فراخوانی API از اکشن‌های سروری صفحه‌های ورود/بازیابی.
 *
 * چرا این فایل هست: قبلاً `loginAction` مستقیم `fetch` می‌زد. اگر API بالا
 * نبود (که در محیط محلی زیاد پیش می‌آید)، fetch استثنا می‌داد و کاربر به‌جای
 * پیام روشن، مرز خطای پنل («این بخش الان باز نشد») را می‌دید — همان چیزی که
 * «با رمز و نام کاربری باز نمی‌شود» به نظر می‌رسد. بدتر: هر خطای سرور (۵۰۰)
 * هم به «ایمیل یا رمز نادرست» ترجمه می‌شد.
 *
 * حالا سه حالت از هم جدا می‌شوند:
 *   unauthorized — ۴۰۱/۴۰۳: واقعاً ایمیل یا رمز غلط است
 *   failed       — بقیهٔ پاسخ‌های ناموفق: سرور بالا است ولی خطا داد
 *   unreachable  — هیچ پاسخی نرسید: API خاموش/شبکه قطع
 */

export type UpstreamFailure = "unauthorized" | "failed" | "unreachable";

export type UpstreamResult<T> =
  | { ok: true; data: T | null; setCookie: string | null }
  | { ok: false; reason: Exclude<UpstreamFailure, "unreachable">; status: number }
  | { ok: false; reason: "unreachable"; status: 0; detail: string };

/** آدرس API — همان قراردادی که `lib/api.ts` برای سرور استفاده می‌کند. */
export function apiOrigin(): string {
  return process.env.API_ORIGIN ?? "http://localhost:4000";
}

/**
 * POST به API با محدودیت زمانی.
 * `path` شامل پیشوند `/api/v1` است (مثلاً `/api/v1/auth/login`).
 */
export async function postUpstream<T = unknown>(
  path: string,
  body: unknown,
  timeoutMs = 8000,
): Promise<UpstreamResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${apiOrigin()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // ECONNREFUSED / DNS / timeout — هیچ پاسخی نرسید
    return { ok: false, reason: "unreachable", status: 0, detail: e instanceof Error ? e.message : String(e) };
  }
  if (res.status === 401 || res.status === 403) {
    return { ok: false, reason: "unauthorized", status: res.status };
  }
  if (!res.ok) return { ok: false, reason: "failed", status: res.status };
  const data = (await res.json().catch(() => null)) as T | null;
  return { ok: true, data, setCookie: res.headers.get("set-cookie") };
}

/** کد خطایی که به صفحهٔ ورود برمی‌گردانیم — هر حالت پیام خودش را دارد. */
export type LoginFailureCode = "credentials" | "server" | "down";

export function loginFailureCode(reason: UpstreamFailure): LoginFailureCode {
  if (reason === "unauthorized") return "credentials";
  if (reason === "unreachable") return "down";
  return "server";
}

export interface EntryNotice {
  tone: "err" | "ok";
  text: string;
}

/**
 * متنِ پیامِ صفحه‌های ورود/بازیابی برای کدِ خطای URL.
 * کد ناشناخته → null (هیچ پیامی نشان داده نمی‌شود، نه پیامِ حدسی).
 */
export function entryNotice(param: string | undefined): EntryNotice | null {
  switch (param) {
    case "credentials":
      return { tone: "err", text: "ایمیل یا رمز نادرست است." };
    case "down":
      return {
        tone: "err",
        text: "سرور پنل پاسخ نمی‌دهد — تا وقتی API بالا نیامده، ورود با رمز درست هم انجام نمی‌شود.",
      };
    case "server":
      return { tone: "err", text: "سرور پنل خطا داد؛ چند لحظه بعد دوباره تلاش کن." };
    case "sent":
      return {
        tone: "ok",
        text: "اگر این ایمیل در سیستم باشد، پیام بازیابی ارسال شده است. (اعتبار کد: ۳۰ دقیقه)",
      };
    case "reset":
      return { tone: "ok", text: "رمز با موفقیت تغییر کرد — با رمز جدید وارد شو." };
    case "invalid":
      return {
        tone: "err",
        text: "کد نامعتبر یا منقضی شده، یا رمزها یکسان‌اند یا کوتاه‌تر از ۸ کاراکترند — دوباره تلاش کن.",
      };
    default:
      return null;
  }
}
