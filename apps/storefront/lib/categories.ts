import type { CategorySlug } from "./attributes";

/**
 * دسته‌های اصلی فروشگاه (بند ۶ spec).
 * دسته‌های فرعی (لاینر، مایو، برلت و…) تا وقتی موجودی واقعی ندارند اضافه نمی‌شوند.
 */
export interface Category {
  id: CategorySlug;
  slug: string;
  name: string;
  /** توضیح کوتاه برای SEO، Hero Drawer و هدر صفحه دسته */
  blurb: string;
}

export const CATEGORIES: Category[] = [
  { id: "bra", slug: "bra", name: "سوتین", blurb: "فنردار و بدون فنر" },
  { id: "panty", slug: "panty", name: "شورت", blurb: "نخی، بدون درز" },
  { id: "set", slug: "set", name: "ست لباس زیر", blurb: "هماهنگ و ظریف" },
  { id: "shapewear", slug: "shapewear", name: "گن", blurb: "فرم‌دهی ملایم" },
  { id: "sport", slug: "sport", name: "ورزشی", blurb: "پشتیبانی در حرکت" },
  { id: "sleepwear", slug: "sleepwear", name: "لباس خواب", blurb: "نرم برای شب" },
];

export const getCategoryBySlug = (slug: string): Category | undefined =>
  CATEGORIES.find((c) => c.slug === slug);
