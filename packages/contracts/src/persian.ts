/**
 * توابع مشترک نرمال‌سازی و slugify فارسی
 * تک‌منبع برای storefront/ادمین/API (بسته A1)
 */

// لیست اسلاگ‌های رزرو (مسیرهای موجود در storefront)
export const RESERVED_SLUGS = new Set<string>([
  "cart",
  "checkout",
  "search",
  "account",
  "wishlist",
  "need",
  "guides",
  "track",
  "about",
  "contact",
  "terms",
  "privacy",
  "returns",
  "shipping",
  "order",
  "api",
  "admin",
  "pos",
  "c",
  "p",
  "health",
  "robots.txt",
  "sitemap.xml",
  "manifest.json",
  "favicon.ico",
  "sw.js",
]);

/**
 * نرمال‌سازی متن فارسی
 * - تبدیل ی عربی → ی فارسی، ک عربی → ک فارسی
 * - ارقام عربی/فارسی → لاتین
 * - حذف کاراکترهای کنترلی
 * - یکسان‌سازی فاصله‌ها (حذف فضاهای تکراری)
 * - نگه‌داری نیم‌فاصله (U+200C) برای matching نسخه‌های با/بدون نیم‌فاصله فراهم می‌شود
 */
export function normalizePersian(input: string): string {
  if (!input) return "";
  
  let result = input
    // تبدیل ی و ک عربی به فارسی
    .replace(/[\u064A\u0649]/g, "\u06CC") // ی عربی → ی فارسی
    .replace(/[\u0643]/g, "\u06A9")        // ک عربی → ک فارسی
    // ارقام عربی → لاتین
    .replace(/[\u0660-\u0669]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x0660 + 0x0030))
    // ارقام فارسی → لاتین
    .replace(/[\u06F0-\u06F9]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x06F0 + 0x0030))
    // حذف کاراکترهای کنترلی
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    // یکسان‌سازی فاصله‌ها (چندین فاصله → یک فاصله)
    .replace(/\s+/g, " ")
    .trim();
  
  return result;
}

/**
 * نسخه «فاصله‌شده» برای matching جستجو
 * نیم‌فاصله (U+200C) را به فاصله معمولی تبدیل می‌کند
 */
export function normalizePersianForSearch(input: string): string {
  return normalizePersian(input).replace(/\u200C/g, " ");
}

/**
 * تبدیل نام فارسی به اسلاگ امن URL
 * - نرمال‌سازی فارسی
 * - فاصله و نیم‌فاصله → -
 * - حروف لاتین → lowercase
 * - حذف کاراکترهای غیرمجاز
 * - حذف - تکراری و از ابتدا/انتها
 */
export function slugifyFa(input: string): string {
  if (!input) return "";
  
  let result = normalizePersian(input)
    // فاصله و نیم‌فاصله به -
    .replace(/[\s\u200C]+/g, "-")
    // فقط حروف، ارقام، - مجاز هستند
    .replace(/[^\u0600-\u06FF\u0750-\u077Fa-zA-Z0-9\-]/g, "")
    // حروف لاتین به lowercase
    .replace(/[A-Z]/g, (ch) => ch.toLowerCase())
    // - تکراری به یکی
    .replace(/-+/g, "-")
    // حذف - از ابتدا و انتها
    .replace(/^-+|-+$/g, "");
  
  return result;
}

/**
 * اطمینان از یکتای بودن اسلاگ
 * اگر base تکراری باشد، پسوند -2، -3، ... اضافه می‌کند
 */
export async function ensureUniqueSlug(
  base: string,
  exists: (slug: string) => boolean | Promise<boolean>
): Promise<string> {
  let slug = base;
  let counter = 2;
  
  while (await exists(slug)) {
    slug = `${base}-${counter}`;
    counter++;
  }
  
  return slug;
}

/**
 * چک می‌کند آیا اسلاگ رزرو شده است
 */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}

/**
 * اعتبارسنجی اسلاگ (رزرو نشده، فرمت درست)
 */
export function validateSlug(slug: string): { valid: boolean; error?: string } {
  if (!slug || slug.length === 0) {
    return { valid: false, error: "اسلاگ خالی است" };
  }
  
  if (slug.length > 200) {
    return { valid: false, error: "اسلاگ بسیار طولانی است (حداکثر ۲۰۰ کاراکتر)" };
  }
  
  if (isReservedSlug(slug)) {
    return { valid: false, error: "این اسلاگ رزرو شده و قابل استفاده نیست" };
  }
  
  // فقط کاراکترهای مجاز
  if (!/^[\u0600-\u06FF\u0750-\u077Fa-z0-9\-]+$/.test(slug)) {
    return { valid: false, error: "اسلاگ شامل کاراکترهای غیرمجاز است" };
  }
  
  if (slug.startsWith("-") || slug.endsWith("-")) {
    return { valid: false, error: "اسلاگ نمی‌تواند با - شروع یا تمام شود" };
  }
  
  if (slug.includes("--")) {
    return { valid: false, error: "اسلاگ نمی‌تواند - تکراری داشته باشد" };
  }
  
  return { valid: true };
}

/**
 * مترادف‌های دامنه برای جستجوی فارسی
 */
export const PERSIAN_SYNONYMS: Record<string, string[]> = {
  "سوتین": ["قف", "قف‌بندی"],
  "شلوار": ["شورت", "پیراهن"],
  "بادی": ["بادی‌سوت", "بادی سوت"],
  "ورزشی": ["اسپرت", "اسپرت"],
  "گن": ["شکل", "مدل"],
  "پیراهن خواب": ["لباس خواب", "نایتی"],
  "نایتی": ["لباس خواب", "پیراهن خواب"],
  "ست": ["سوت و شورت", "سوت‌وشلوار"],
  "سوئیشرت": ["هودی", "هودی"],
  "کاپشن": ["کپشن", "کلاه"],
  "دامن": ["اس커ت", "اسکرت"],
  "بلوز": ["تی‌شرت", "تیشرت", "پیراهن"],
  "جوراب": ["جوراب‌ها", "جوراب ها"],
  "کفش": ["бот", "بوت", "صندل", "کفش‌های"],
  "کیف": ["کفش", "چمدان", "کوله"],
  "شال": [" روسری", "روسری", "حجاب"],
  "مانتو": ["مانتوها", "روب"],
  "روپوش": ["لباس", "پوشاک"],
};

/**
 * گسترش کوئری جستجو با مترادف‌ها
 */
export function expandSearchQuery(query: string): string[] {
  const normalized = normalizePersianForSearch(query);
  const words = normalized.split(/\s+/).filter(Boolean);
  const expanded = new Set<string>([normalized]);
  
  for (const word of words) {
    const synonyms = PERSIAN_SYNONYMS[word];
    if (synonyms) {
      for (const syn of synonyms) {
        expanded.add(normalizePersianForSearch(syn));
      }
    }
    // هم‌چنین جستجو در کلیدهای مترادف (مقادیر)
    for (const [key, syns] of Object.entries(PERSIAN_SYNONYMS)) {
      if (syns.includes(word)) {
        expanded.add(normalizePersianForSearch(key));
        for (const s of syns) {
          expanded.add(normalizePersianForSearch(s));
        }
      }
    }
  }
  
  return Array.from(expanded);
}