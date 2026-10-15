/**
 * جایگزینی امنِ متن کاربر در سورس — قلب «انتشار با تأیید» صفحهٔ ممیزی.
 *
 * چرا مستقل از Next است؟ تا همان منطقِ حساس (لمس فایلِ سورس) با تستِ Node
 * پوشش داده شود (`lib/copy.test.mjs` هر اپ) — روت ادمین فقط صدای این تابع
 * می‌زند و خطاها را به HTTP ترجمه می‌کند.
 *
 * قاعده‌ها:
 *   • متن باید دقیقاً یک‌بار در خطِ داده‌شده پیدا شود (وگرنه LINE_NOT_UNIQUE)
 *   • اگر در کل فایل یک‌بار بود، بدون خط هم می‌شود پیدا کرد
 *   • فایلِ نتیجه باید بیلد‌پذیر بماند: چون فقط خودِ زیررشته جایگزین
 *     می‌شود، ساختار quote دست نمی‌خورد — به‌شرطی که متنِ جایگزین
 *     همان سبک quote را نشکند؛ برای اطمینان، quote و backslash ممنوع‌اند.
 */

/** @typedef {{code: "NOT_FOUND"|"LINE_NOT_UNIQUE"|"UNSAFE_REPLACEMENT", message: string}} ApplyError */

export class ReplacementError extends Error {
  /**
   * @param {ApplyError["code"]} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * متن `text` را با `replacement` در `src` جایگزین می‌کند و سورسِ تازه برمی‌گرداند.
 * @param {string} src
 * @param {{text: string, replacement: string, line?: number}} opts
 * @returns {string}
 */
export function applyReplacement(src, opts) {
  const { text, replacement, line } = opts;
  if (!text || text === replacement) {
    throw new ReplacementError("NOT_FOUND", "متن اصلی خالی است یا با جایگزین یکی است.");
  }
  // متنِ جایگزین نباید بتواند از رشتهٔ سورس بیرون بزند (سورس خراب = بیلد خراب)
  if (/["'`\\\n\r]/.test(replacement)) {
    throw new ReplacementError(
      "UNSAFE_REPLACEMENT",
      "متن جایگزین نباید نقل‌قول، بک‌اسلش یا خطِ تازه داشته باشد.",
    );
  }
  if (!src.includes(text)) {
    throw new ReplacementError("NOT_FOUND", "متن در فایل پیدا نشد؛ ممیزی را دوباره اجرا کن.");
  }
  const lines = src.split("\n");
  const idx = typeof line === "number" && line >= 1 && line <= lines.length ? line - 1 : -1;
  if (idx >= 0) {
    const hits = lines[idx].split(text).length - 1;
    if (hits === 1) {
      lines[idx] = lines[idx].replace(text, replacement);
      return lines.join("\n");
    }
    if (hits > 1) {
      throw new ReplacementError("LINE_NOT_UNIQUE", "متن در این خط بیش از یک‌بار آمده است.");
    }
    // در خطِ ممیزی نبود (فایل جابه‌جا شده) — به یکتایی در کل فایل رجوع کن
  }
  const total = src.split(text).length - 1;
  if (total === 1) return src.replace(text, replacement);
  throw new ReplacementError(
    total > 1 ? "LINE_NOT_UNIQUE" : "NOT_FOUND",
    total > 1
      ? "متن در چند جای فایل آمده است؛ خطِ دقیق را از ممیزی تازه بگیر."
      : "متن در فایل پیدا نشد؛ ممیزی را دوباره اجرا کن.",
  );
}
