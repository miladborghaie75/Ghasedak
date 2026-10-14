/**
 * گام F0-4 — پیکربندی بوت: پورت و هدف دیتابیس.
 *
 * این‌ها عمداً توابع خالص‌اند تا بدون بالا آوردن اپ هم تست شوند؛ منطق واقعی
 * بوت (اتصال و exit) در main.ts است.
 */

/** پیش‌فرض کانونیکال API در dev/prod لوکال (run-local.sh هم همین را می‌دهد) */
export const DEFAULT_API_PORT = 4000;

export interface PortResolution {
  port: number;
  /** پیام هشدار فارسی وقتی مقدار env نامعتبر بود — در بوت لاگ می‌شود */
  warning?: string;
}

/**
 * `PORT` را قطعی می‌کند.
 *
 * نکتهٔ مستندشده (F0-4): `PORT=0` در Node یعنی «یک پورت تصادفی آزاد بگیر»؛
 * این در سرویس واقعی یعنی آدرس سرویس هر بوت عوض می‌شود و کلاینت/مونیتورینگ
 * گم می‌شود. پس هر مقدار غیرمعتبر (۰، منفی، غیرعدد، >65535) صریحاً به
 * پیش‌فرض برمی‌گردد و **لاگ هشدار** می‌دهد — نه سقوط و نه سکوت.
 */
export function resolvePort(rawPort: string | undefined | null, fallback = DEFAULT_API_PORT): PortResolution {
  if (rawPort == null || String(rawPort).trim() === "") return { port: fallback };
  const raw = String(rawPort).trim();
  // فقط رقم‌های ساده مجازند — `1e3`/`12.5`/`+80`/`0x50` پورت معتبر نیستند
  if (!/^\d{1,5}$/.test(raw)) {
    return { port: fallback, warning: invalidPortWarning(raw, fallback) };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    return { port: fallback, warning: invalidPortWarning(raw, fallback) };
  }
  return { port: n };
}

function invalidPortWarning(raw: string, fallback: number): string {
  return (
    `PORT="${raw}" نامعتبر است — پورت ${fallback} استفاده می‌شود. ` +
    "توجه: PORT=0 در Node یعنی «پورت تصادفی»؛ در سرویس واقعی همیشه پورت صریح بدهید."
  );
}

/**
 * هدف اتصال DB به شکل ایمن برای پیام خطا — **بدون کاربر/رمز**.
 * مثال: `127.0.0.1:5433/ghasedak`
 */
export function describeDbTarget(url: string | undefined | null): string {
  if (!url) return "DATABASE_URL تنظیم نشده";
  try {
    const u = new URL(url);
    const db = u.pathname.replace(/^\//, "") || "(بدون نام)";
    return `${u.hostname}:${u.port || "5432"}/${db}`;
  } catch {
    return "DATABASE_URL نامعتبر (قابل parse نیست)";
  }
}

/**
 * اولین سطر *غیرخالی* خطا.
 * نکتهٔ عملی: پیام PrismaClientInitializationError با `\n` شروع می‌شود، پس
 * `message.split("\n")[0]` رشتهٔ خالی می‌دهد و علت واقعی در لاگ گم می‌شود.
 */
export function firstErrorLine(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: string }).code;
    const lines = error.message
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      // سرصفحهٔ فراخوانی Prisma و سطر «کد کجاست» توضیح علت نیستند
      .filter((s) => !s.startsWith("Invalid `") && !s.startsWith("→") && !/^[A-Za-z]:\\/.test(s) && !/^\/[^ ]+\.(js|ts):\d+/.test(s));
    if (lines.length > 0) return lines[0];
    return code ? `${error.name} (${code})` : error.name;
  }
  return String(error);
}

/** پیام خطای روشن وقتی DB در دسترس نیست (بند ۱۱۸: شکست بی‌صدا ممنوع) */
export function dbUnreachableMessage(url: string | undefined | null, error: unknown): string {
  const detail = firstErrorLine(error);
  return [
    `[ghasedak-api] اتصال به دیتابیس برقرار نشد → ${describeDbTarget(url)}`,
    `  علت: ${detail}`,
    "  بررسی کنید: کلستر درست بالا است؟ (`bash infrastructure/run-local.sh start` در ریپو، یا `status`)",
    "  پورت‌های کانونیکال: تمرین 55433 · اصلی/dev 5433 (روی سرور production همان پورت سرویس postgres).",
    "  DATABASE_URL فعلی را در .env / متغیر محیطی درست کنید — بوت بی‌دیتابیس متوقف می‌شود (fallback پنهان نداریم).",
  ].join("\n");
}
