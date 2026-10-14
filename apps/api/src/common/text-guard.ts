import { BadRequestException } from "@nestjs/common";

/**
 * گارد متن ورودی (گام F0-3) — «دادهٔ خراب هرگز از نو وارد نشود».
 *
 * ریشهٔ یافتهٔ بازرسی: دو محصول منتشرشده در کاتالوگ عمومی نام‌شان تماماً
 * U+FFFD بود و اسلاگ‌شان به `-` و `--muena3ig` فرو ریخته بود. U+FFFD
 * کاراکتر *جانشین* یونیکد است و هرجا متنی با انکودینگ اشتباه وارد شود
 * می‌نشیند؛ یعنی بایت‌های اصلی از دست رفته‌اند و نام اصلی بازقابل‌ساخت
 * نیست. پس درست‌ترین جا برای این رفع، همان لحظهٔ نوشتن است نه پاک‌سازی
 * دیرهنگام.
 *
 * خط مشی: «رد کن»، نه sanitize بی‌صدا — متن خراب با خطای فارسی روشن و
 * `fieldErrors` به فرم برمی‌گردد تا کاربر مقدار را درست کپی/پیست کند.
 * (پاک‌کردن خودکار U+FFFD یعنی تبدیل بی‌صدا به متن جعلی.)
 */

/** کاراکتر جانشین یونیکد — نشانهٔ قطعی متن خراب‌شده */
export const REPLACEMENT_CHAR = "\uFFFD";

/** کاراکترهای کنترلی مجاز؛ چندخطی‌بودن توضیحات را نمی‌شکنیم */
const ALLOWED_CONTROL = new Set(["\n", "\r", "\t"]);

export type DirtyTextReason = "REPLACEMENT_CHAR" | "CONTROL_CHAR";

/** دلیل خرابی متن — یا null وقتی متن سالِم است */
export function findDirtyText(value: string | null | undefined): DirtyTextReason | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.includes(REPLACEMENT_CHAR)) return "REPLACEMENT_CHAR";
  for (const ch of value) {
    if (ALLOWED_CONTROL.has(ch)) continue;
    const code = ch.codePointAt(0) ?? 0;
    // C0 (به‌جز \n \r \t)، DEL و C1 — جای این‌ها در متن کاربرپسند نیست
    if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return "CONTROL_CHAR";
  }
  return null;
}

const REASON_MESSAGE: Record<DirtyTextReason, string> = {
  REPLACEMENT_CHAR:
    "متن شامل کاراکتر نامعتبر (نشانهٔ U+FFFD) است — مقدار با انکودینگ اشتباه وارد شده؛ آن را از منبع اصلی (UTF-8) دوباره کپی کنید.",
  CONTROL_CHAR: "متن شامل کاراکتر کنترلی نامجاز است (به‌جز خط جدید و تب).",
};

/** فیلدهای خرابِ یک شیء — برای برگرداندن همهٔ خطاها با یک درخواست */
export function dirtyTextFields(
  fields: Record<string, string | null | undefined>,
): Array<{ field: string; reason: DirtyTextReason }> {
  const out: Array<{ field: string; reason: DirtyTextReason }> = [];
  for (const [field, value] of Object.entries(fields)) {
    const reason = findDirtyText(value);
    if (reason) out.push({ field, reason });
  }
  return out;
}

/**
 * اعتبارسنجی چند فیلد متنی با هم.
 * همهٔ فیلدهای خراب در یک پاسخ می‌آیند تا کاربر فرم را چندبار نفرستد.
 */
export function assertCleanFields(
  fields: Record<string, string | null | undefined>,
  code = "INVALID_TEXT",
): void {
  const dirty = dirtyTextFields(fields);
  if (dirty.length === 0) return;
  const fieldErrors: Record<string, string[]> = {};
  for (const d of dirty) fieldErrors[d.field] = [REASON_MESSAGE[d.reason]];
  throw new BadRequestException({
    code,
    message: "متن وارد‌شده نامعتبر است.",
    fieldErrors,
  });
}

/** اعتبارسنجی یک فیلد — برای مسیرهای تک‌فیلدی (نام دسته/برند) */
export function assertCleanText(value: string | null | undefined, field: string): void {
  assertCleanFields({ [field]: value });
}
