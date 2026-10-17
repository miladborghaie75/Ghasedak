/**
 * نویسندهٔ CSV گزارش‌های مالی (گام ۱۲ · `[F1-2]`) — خالص و تست‌پذیر.
 *
 * چرا ماژول جدا و نه بازاستفاده از مسیر بکاپ: `infrastructure/backup` هر جدول
 * را با `COPY … FORMAT csv` می‌ریزد؛ آن قالب برای dump/restore پستگرس است
 * (بدون BOM، نام‌گذاری `<Table>.csv`) و برای فایلی که کاربر در Excel باز
 * می‌کند مناسب نیست. اینجا:
 *   ۱) BOM یونیکد اول فایل — بدون آن Excel فارسی متن را «Ø¯Ø§Ø¯Ù‡» نشان می‌دهد.
 *   ۲) خنثی‌سازی تزریق فرمول: سلولی که با `=` `+` `@` یا tab/CR شروع شود،
 *      و همچنین سلولی که با `-` شروع شود ولی عدد خالص نباشد، یک نقل‌قول
 *      پیشوندی می‌گیرد؛ وگرنه Excel آن را اجرا می‌کند (CSV Injection).
 *      استثنای `-1234` عمدی است: عدد منفی باید عدد بماند. این ریسک واقعی
 *      است چون متن بعضی گزارش‌ها از ورودی کاربر می‌آید.
 *   ۳) نقل‌قول RFC4180 برای هر سلولی که کاما/نقل‌قول/خط جدید دارد.
 *   ۴) پایان خط `\r\n` (سازگار با Excel ویندوز).
 * اعداد با رقم لاتین و بدون جداکنندهٔ هزارگان صادر می‌شوند تا در Excel «عدد»
 * بمانند؛ نمایش فارسی فقط در UI است.
 */

export const CSV_BOM = "\uFEFF";

/** سلولی که Excel ممکن است به‌عنوان فرمول اجرا کند */
const FORMULA_START = /^[=+@\t\r]/;
/** عدد لاتین خالص — منفی و اعشاری هم عدد است، نه فرمول */
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/** یک سلول امن CSV (بدون کاما/پایان خط) */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // `-` روی عدد خالص (`-1234`) بی‌خطر است و باید **عدد** بماند؛ وگرنه خالص
  // منفی همهٔ گزارش‌ها در Excel متن می‌شد. اما `-2+3+…` که با عدد شروع
  // می‌شود و ادامهٔ فرمولی دارد، خنثی می‌شود.
  const dashesFormula = s.startsWith("-") && !PLAIN_NUMBER.test(s);
  if (FORMULA_START.test(s) || dashesFormula) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** جدول → متن CSV با BOM و پایان خط ویندوزی (بدون BOM؛ آن را لایهٔ HTTP می‌گذارد) */
export function toCsv(rows: Array<Array<string | number | bigint | null | undefined>>): string {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  return body.length > 0 ? `${body}\r\n` : "";
}

/**
 * نام فایل ASCII-safe با بازهٔ تاریخ لاتین: `cash-flow-2026-01-01_2026-10-17.csv`
 *
 * تاریخ با **تقویم محلی اپراتور** نوشته می‌شود، نه `toISOString`: بازهٔ «از اول
 * سال» در تهران برابر `2025-12-31T20:30Z` است و اگر تاریخ UTC چاپ شود، نام
 * فایل می‌گوید ۲۰۲۵-۱۲-۳۱ در حالی که گزارش سال ۲۰۲۶ است — همان چیزی که
 * در سنجش اول دیده شد.
 */
export function csvFilename(base: string, from?: Date | null, to?: Date | null): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const part = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // نام پایه: هر چیز غیرلاتین به `-` و `-`های تکراری/ابتدایی/انتهایی حذف —
  // وگرنه `CASH Flow!` نام فایلی مثل `cash-flow--all.csv` می‌داد.
  const safeBase = base.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "report";
  if (!from && !to) return `${safeBase}-all.csv`;
  if (from && to) return `${safeBase}-${part(from)}_${part(to)}.csv`;
  return `${safeBase}-${from ? `from-${part(from)}` : `to-${part(to as Date)}`}.csv`;
}
