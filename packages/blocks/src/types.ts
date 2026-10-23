import type { CmsBlock, ContentNavItem } from "@ghasedak/contracts";

/**
 * شکل داده‌ای که بلوک‌های فروشگاهی (محصول/دسته) برای رندر لازم دارند.
 *
 * چرا پاس‌دادنی و نه اینکه خودِ بلوک داده بگیرد؟ چون همین کامپوننت‌ها
 * هم در فروشگاه (دادهٔ زندهٔ کاتالوگ) و هم در بوم صفحه‌سازِ ادمین
 * (پیش‌نمایش زنده با همان داده) رندر می‌شوند. هر دو از یک شکل یکسان
 * تغذیه می‌شوند، پس آنچه در بوم می‌بینید همان چیزی است که
 * در سایت منتشر می‌شود.
 */

export interface CmsProduct {
  id: string;
  slug: string;
  name: string;
  /** قیمت به تومان — عدد صحیح */
  price: number;
  compareAt?: number | null;
  imageUrl?: string | null;
  badge?: string | null;
  isNew?: boolean;
  inStock?: boolean;
}

export interface CmsCategory {
  slug: string;
  name: string;
  blurb?: string;
  /** آیکون/تصویر دسته که مدیر در پنل تعریف کرده */
  imageUrl?: string | null;
}

export interface CmsGuide {
  slug: string;
  title: string;
}

export interface CmsBrand {
  slug: string;
  name: string;
  logoUrl?: string | null;
}

export interface CmsData {
  products: CmsProduct[];
  categories: CmsCategory[];
  brands: CmsBrand[];
  guides: CmsGuide[];
  /**
   * ناوبریِ صفحه‌های محتوایی — از تنظیمِ سراسریِ پنل می‌آید (فروشگاه از
   * API عمومی می‌خواند)، پس همان نوار در سایت و بوم یکی است.
   *
   * غایب (`undefined`) یعنی هنوز تنظیمی ذخیره نشده → ناوبریِ پیش‌فرضِ قرارداد؛
   * آرایهٔ خالی یعنی مدیر همه را پنهان کرده → نوار رندر نمی‌شود.
   */
  nav?: ContentNavItem[];
}

export const EMPTY_CMS_DATA: CmsData = { products: [], categories: [], brands: [], guides: [] };

/** انتخاب محصولات بر اساس فیلد `source` در بلوک */
export function pickProducts(data: CmsData, source: unknown, limit: number): CmsProduct[] {
  const all = data.products;
  if (source === "discounted") {
    return all.filter((p) => p.compareAt != null && p.compareAt > p.price).slice(0, limit);
  }
  if (source === "all") return all.slice(0, limit);
  const newest = all.filter((p) => p.isNew);
  return (newest.length > 0 ? newest : all).slice(0, limit);
}

export interface CmsBlockProps {
  block: CmsBlock;
  data: CmsData;
  /**
   * عنوانِ صفحه — برای بلوک‌هایی که `h1` را از عنوانِ صفحه می‌سازند
   * (مثل `CONTENT_PAGE` که در سایت هم `h1` صفحه از همین‌جا می‌آید).
   */
  pageTitle?: string;
}

/** خواندن امن یک prop رشته‌ای */
export function pStr(props: Record<string, unknown>, key: string, fallback = ""): string {
  const v = props[key];
  return typeof v === "string" ? v : fallback;
}

/** خواندن امن یک prop عددی */
export function pNum(props: Record<string, unknown>, key: string, fallback: number): number {
  const v = Number(props[key]);
  return Number.isFinite(v) ? v : fallback;
}

/** خواندن یک لیست از اشیاء */
export function pItems(props: Record<string, unknown>, key: string): Array<Record<string, string>> {
  const v = props[key];
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(x)) out[k] = typeof val === "string" ? val : String(val ?? "");
      return out;
    });
}