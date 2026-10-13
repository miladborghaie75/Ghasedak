import * as path from "path";

/**
 * پوشهٔ رسانه — تنها منبع حقیقت.
 *
 * چرا این فایل وجود دارد: مسیر رسانه قبلاً در سه جا جداگانه محاسبه می‌شد —
 * `capabilities.controller` (آپلود/حذف)، `media-serve.controller` (سرو) و
 * `diagnostics.controller` (پایش). دو تای اول fallback داشتند و سومی نداشت،
 * بنابراین صفحهٔ تشخیص همیشه «پوشه در دسترس نیست: N/A» هشدار می‌داد در حالی
 * که آپلود و سرو هر دو درست کار می‌کردند.
 *
 * حالا هر سه از `mediaDir()` می‌خوانند؛ برای تغییر مسیر کافی است `MEDIA_DIR`
 * را در env ست کنید (در production الزامی است، چون cwd اپ ممکن است متفاوت باشد).
 *
 * چرا تابع و نه ثابت؟ چون ثابت در لحظهٔ import مقداردهی می‌شود و تغییر
 * `process.env.MEDIA_DIR` بعد از آن (مثلاً در تست) هیچ اثری ندارد. با تابع،
 * هر فراخوانی مقدار تازهٔ env را می‌بیند و سه مصرف‌کننده همچنان
 * دقیقاً یک مسیر دارند.
 */
export function mediaDir(): string {
  const fromEnv = process.env.MEDIA_DIR;
  return fromEnv ? path.resolve(fromEnv) : path.resolve(process.cwd(), "../data/media");
}

/**
 * مقدار پیش‌فرض — فقط برای سازگاری با کد قدیمی.
 * در بیشتر موارد `mediaDir()` درست‌تر است چون env را در زمان اجرا می‌خواند.
 */
export const MEDIA_DIR: string = mediaDir();

/**
 * تبدیل یک کلید رسانه به مسیر امن داخل پوشهٔ رسانه.
 * کلیدهایی که به بیرون دایرکتوری اشاره کنند `null` برمی‌گردانند
 * (جلوگیری از path traversal — بند ۱۱۰).
 */
export function safeMediaPath(key: string): string | null {
  if (!key || key.includes("..") || key.includes("/") || key.includes("\\")) return null;
  const root = mediaDir();
  const safe = path.resolve(root, key);
  return safe === root || safe.startsWith(root + path.sep) ? safe : null;
}

/** آیا پوشهٔ رسانه وجود دارد و قابل نوشتن است؟ */
export function mediaDirReady(): { ok: boolean; dir: string; reason?: string } {
  try {
    const fs = require("fs") as typeof import("fs");
    const dir = mediaDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.accessSync(dir, fs.constants.W_OK);
    return { ok: true, dir };
  } catch (e) {
    return { ok: false, dir: mediaDir(), reason: e instanceof Error ? e.message : String(e) };
  }
}