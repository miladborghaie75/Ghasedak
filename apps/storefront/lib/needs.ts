import type { CategorySlug } from "./attributes";
import type { ProductV2 } from "./catalog";

/**
 * Need-based discovery (بند ۹ spec).
 * هر نیاز به فیلترهای ساختاریافته (دسته/جنس/بودجه) نگاشت می‌شود —
 * نه برچسب جعلی. «هنوز نمی‌دونم» ویزارد سه‌مرحله‌ای را باز می‌کند.
 */
export interface Need {
  slug: string;
  label: string;
  /** انطباق: دسته‌های مرتبط */
  categories?: CategorySlug[];
  /** انطباق: جنس‌های ترجیحی (OR) */
  materialIds?: string[];
  /** انطباق: سقف بودجه */
  priceMax?: number;
  /** دلیل انطباق — به کاربر نشان داده می‌شود (بند ۹) */
  why: string;
}

export const NEEDS: Need[] = [
  {
    slug: "everyday",
    label: "استفاده روزمره",
    categories: ["bra", "panty", "set"],
    why: "مدل‌های ساده و راحت برای هر روز",
  },
  {
    slug: "formal",
    label: "زیر لباس مجلسی",
    categories: ["bra", "panty", "set"],
    why: "فرم صاف بدون برجستگی زیر لباس",
  },
  {
    slug: "sport",
    label: "ورزش",
    categories: ["sport"],
    why: "پشتیبانی مناسب در حرکت",
  },
  {
    slug: "shaping",
    label: "فرم‌دهی و ایستایی",
    categories: ["shapewear"],
    why: "فرم‌دهی ملایم و طبیعی",
  },
  {
    slug: "comfort",
    label: "راحتی",
    categories: ["bra", "panty", "sleepwear"],
    materialIds: ["mt-cotton", "mt-modal"],
    why: "جنس نرم و نفس‌کش",
  },
  {
    slug: "gift",
    label: "هدیه",
    categories: ["set", "sleepwear"],
    why: "انتخاب‌های ویژه برای هدیه",
  },
];

/** انطباق یک محصول با یک نیاز — قواعد AND بین بُعدها، OR داخل هر بُعد */
export function matchesNeed(p: ProductV2, need: Need): boolean {
  if (need.categories && !need.categories.includes(p.category)) return false;
  if (
    need.materialIds &&
    !need.materialIds.some((m) => p.attributeIds.includes(m))
  )
    return false;
  return true;
}
