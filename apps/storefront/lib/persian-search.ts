/**
 * هستهٔ جست‌وجوی فارسی (گام ۲۰) — منطق خالص و جدا از repo تا با node:test
 * بدون شبکه/DB قابل تست باشد (فایل `persian-search.test.ts`).
 */
import { persianLoose } from "@ghasedak/contracts";

/** حداقلِ حداقل‌ها برای هر سند قابل جست‌وجو */
export interface SearchableDoc {
  name: string;
  short?: string | null;
}

/**
 * مترادف‌های دامنهٔ پوشاک زیر — از نام/توضیح واقعی کاتالوگ استخراج شده‌اند
 * (هر دو سمت باید در کاتالوگ واقعی دیده شوند؛ جدول حدسی نیست).
 * کلید و مقادیر با `persianLoose` مقایسه می‌شوند تا ی/ک عربی و نیم‌فاصله مسئله نسازد.
 */
export const SEARCH_SYNONYMS: Record<string, string[]> = {
  "سوتین": ["قیف"],
  "شورت": ["شلوار"],
  "بادی": ["بادی سوت"],
  "ورزشی": ["اسپرت"],
  "گن": ["شکل"],
  "پیراهن خواب": ["لباس خواب"],
  "نایتی": ["لباس خواب"],
  "ست": ["سوت", "شورت"],
};

/** از چند نتیجهٔ مستقیم به بعد، مترادف‌ها اصلاً دخالت نمی‌کنند (رتبه‌بندی خراب نمی‌شود) */
export const SYNONYM_MIN_DIRECT_HITS = 3;

/**
 * بسط کوئری با مترادف‌های دامنه — دوطرفه و در همان یک پَرَه (بدون زنجیرهٔ بلند که
 * نتایج بی‌ربط می‌سازد): اگر کلید در کوئری آمد، مقادیرش اضافه می‌شوند؛ و اگر
 * کوئری خودش یکی از مترادف‌ها بود، کلید هم ضمیمه می‌شود. مقدار تکراریِ خودِ کوئری حذف است.
 */
export function expandQuery(term: string): string[] {
  const out = new Set<string>();
  const add = (raw: string): void => {
    const val = persianLoose(raw);
    if (val && !term.includes(val)) out.add(val);
  };
  for (const [key, values] of Object.entries(SEARCH_SYNONYMS)) {
    const k = persianLoose(key);
    if (!k) continue;
    if (term.includes(k)) {
      for (const v of values) add(v);
      continue;
    }
    if (values.some((v) => {
      const val = persianLoose(v);
      return val !== "" && term.includes(val);
    })) {
      add(k);
    }
  }
  return [...out];
}

/**
 * جست‌وجوی فارسی روی مجموعهٔ اسناد:
 *  - کوئری و متن هر دو نرمال می‌شوند (ی/ک عربی، ارقام، فاصله‌ها)؛
 *  - مقایسه روی نسخهٔ «بدون نیم‌فاصله و با فاصلهٔ تکی» انجام می‌شود تا
 *    «بادی سوت» محصول «بادی‌سوت» را بیابد؛
 *  - اگر نتیجهٔ مستقیم کم بود، مترادف‌های دامنه ضمیمه می‌شوند بدون جابه‌جایی ترتیب مستقیم‌ها.
 */
export function searchDocs<T extends SearchableDoc>(q: string, pool: T[]): T[] {
  const term = persianLoose(q);
  if (!term) return pool;
  const hay = pool.map((doc) => ({
    doc,
    text: `${persianLoose(doc.name)} ${persianLoose(doc.short ?? "")}`,
  }));
  const direct = hay.filter((h) => h.text.includes(term)).map((h) => h.doc);
  if (direct.length >= SYNONYM_MIN_DIRECT_HITS) return direct;
  const expanded = expandQuery(term);
  if (expanded.length === 0) return direct;
  const directSet = new Set(direct);
  const extra = hay
    .filter((h) => !directSet.has(h.doc) && expanded.some((e) => h.text.includes(e)))
    .map((h) => h.doc);
  return [...direct, ...extra];
}
