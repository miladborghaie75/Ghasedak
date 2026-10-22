/**
 * وضعیت تعمیر فروشگاه (گام ۱۰) — خواندن از endpoint عمومی API.
 *
 * سه اصل:
 *   ۱) fail-open: اگر API در دسترس نباشد، فروشگاه «خاموش» نمی‌شود؛
 *      تنظیم تعمیر فقط با دستور صریح ادمین اعمال می‌شود، نه با قطع‌وصل شدن API.
 *   ۲) TTL کوتاه (۱۵ ثانیه): خاموش‌کردن تعمیر سریع اثر می‌کند ولی هر رکوئست
 *      بار اضافی به API نمی‌گذارد.
 *   ۳) فقط همین فایل فرم پاسخ را می‌شناسد؛ layout و checkout از این‌جا می‌خوانند.
 */

export interface MaintenanceState {
  enabled: boolean;
  /** پیام اختیاری ادمین برای صفحهٔ اطلاع */
  message?: string;
  /** مهلت اختیاری بازگشت (متن آزاد مثل «امشب») */
  until?: string;
}

const TTL_MS = 15_000;
let cache: { at: number; state: MaintenanceState } | null = null;

export async function getMaintenance(): Promise<MaintenanceState> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.state;
  try {
    const api = process.env.API_ORIGIN ?? "http://localhost:4000";
    const r = await fetch(`${api}/api/v1/admin/public/maintenance`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (r.ok) {
      const m = (await r.json()) as MaintenanceState | null;
      const state: MaintenanceState = {
        enabled: m?.enabled === true,
        message: typeof m?.message === "string" ? m.message : undefined,
        until: typeof m?.until === "string" ? m.until : undefined,
      };
      cache = { at: Date.now(), state };
      return state;
    }
  } catch {
    // fail-open — فروشگاه با قطعی API بسته نمی‌شود
  }
  return { enabled: false };
}
