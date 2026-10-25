/**
 * ابزارهای مشترک فارسی — تک‌منبع برای فروشگاه، ادمین و API (تصمیم قطعی #۳).
 *
 * چرا اینجا: اسلاگ‌های محصول/دسته/صفحهٔ CMS در سه اپ ساخته می‌شوند و اگر هر کدام
 * نرمال‌سازی خودش را داشته باشد، دو «سوتین» یکسان با حروف عربی/فارسی اسلاگهای
 * متفاوت می‌سازند و URL بعداً قابل اصلاح نیست (گران‌ترین تغییر بعد از لانچ).
 * پس همهٔ تبدیل‌ها از همین یک ماژول می‌آید.
 */

/** ي عربی → ی فارسی */
const ARABIC_YEH = "\u064A";
const FARSI_YEH = "\u06CC";
/** ك عربی → ک فارسی */
const ARABIC_KAF = "\u0643";
const FARSI_KAF = "\u06A9";
/** نیم‌فاصله (Zero-Width Non-Joiner) */
export const ZWNJ = "\u200C";

/** ارقام عربی (٠-٩) و فارسی (۰-۹) → لاتین (0-9) */
function digitsToLatin(s: string): string {
  return s
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06F0));
}

/** کاراکترهای کنترلی/جهت‌نمایی که نباید در متن یا اسلاگ بمانند (شامل LRM/RLM و BOM) */
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\uFEFF]/g;

/** حرکت‌های عربی (تَشکیل) — فقط در اسلاگ حذف می‌شوند تا نام خوانا بماند */
const DIACRITICS = /[\u064B-\u0652\u0670]/g;

/**
 * نرمال‌سازی پایهٔ متن فارسی:
 *  - ی/ک عربی → فارسی، ارقام عربی/فارسی → لاتین
 *  - حذف کاراکترهای کنترلی و نشانه‌های جهت‌نویسی
 *  - یکسان‌سازی فاصله‌های شکسته (NBSP و …) به فاصلهٔ ساده + فشردن فاصله‌های پیاپی
 *
 * نیم‌فاصله (U+200C) **حذف یا تبدیل نمی‌شود** — برای «تطبیق» (matching) نسخهٔ
 * جداگانهٔ `persianLoose` را بگیر.
 */
export function normalizePersian(input: string): string {
  return digitsToLatin(String(input ?? ""))
    .replace(new RegExp(ARABIC_YEH, "g"), FARSI_YEH)
    .replace(new RegExp(ARABIC_KAF, "g"), FARSI_KAF)
    .replace(CONTROL_CHARS, "")
    // فاصلهٔ شکسته/نیم‌عرض و دیگر فاصله‌های غیرمعمول → فاصلهٔ ساده
    .replace(/[\u00A0\u2007\u202F\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * نسخهٔ «شل» برای تطبیق جست‌وجو: نیم‌فاصله به فاصله تبدیل و فاصله‌ها فشرده می‌شوند
 * تا «بادی‌سوت» با «بادی سوت» یکی دیده شود. فقط برای مقایسه است؛ ذخیرهٔ داده با
 * `normalizePersian` انجام می‌شود.
 */
export function persianLoose(input: string): string {
  return normalizePersian(input).replace(new RegExp(ZWNJ, "g"), " ").replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * نام فارسی → اسلاگ امن URL (الگوی seed: فاصله و نیم‌فاصله → `-`).
 * خروجی فقط حروف کوچک لاتین، ارقام، فارسی/عربیِ نرمال‌شده و خط تیره است؛
 * نتیجهٔ خالی را `""` برمی‌گرداند تا فراخواننده fallback خودش را بگذارد.
 */
export function slugifyFa(input: string): string {
  return normalizePersian(input)
    .toLowerCase()
    .replace(DIACRITICS, "")
    .replace(/\s+/g, "-")
    .replace(new RegExp(ZWNJ, "g"), "-")
    .replace(/[^a-z0-9\u0600-\u06FF-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * مسیرهای رزروی سطح-یک فروشگاه — اسلاگ هیچ موجودیتی نباید اینها باشد
 * وگرنه صفحهٔ CMS/محصول پشت مسیر ثابت گم می‌شود (فهرست از `apps/storefront/app`).
 */
export const RESERVED_SLUGS: readonly string[] = [
  "about", "account", "admin", "api", "c", "cart", "checkout", "contact",
  "guides", "need", "og-fonts", "order", "p", "pos", "privacy", "returns",
  "search", "shipping", "terms", "track", "wishlist",
];

const RESERVED_SET = new Set(RESERVED_SLUGS);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SET.has(String(slug ?? "").trim().toLowerCase());
}

/**
 * یکتاسازی اسلاگ: در صورت تکرار پس‌وند `-۲`، `-۳`، … می‌زند.
 * `exists` می‌تواند ناهمگام باشد (بررسی DB)؛ حداکثر ۱۰۰۰ تلاش بعد از آن خطا می‌دهد
 * تا حلقهٔ بی‌پایان ممکن نباشد.
 */
export async function ensureUniqueSlug(
  base: string,
  exists: (slug: string) => boolean | Promise<boolean>,
): Promise<string> {
  const clean = String(base ?? "").trim();
  if (!(await exists(clean))) return clean;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${clean}-${n}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new Error(`اسلاگ یکتا برای «${clean}» ساخته نشد — جدول اسلاگها را بررسی کن.`);
}
