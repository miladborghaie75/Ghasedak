/** ماژول مشترک سرور/کلاینت برای سورت — بدون "use client" */

/**
 * بند ۲۱: «پرفروش‌ترین» تا وقتی داده فروش واقعی نداریم وجود ندارد.
 * «بیشترین امتیاز» از خلاصهٔ نظرات تأییدشدهٔ واقعی می‌آید (گام ۱۱) —
 * محصول بدون نظر امتیاز ساختگی نمی‌گیرد و پایین فهرست می‌ماند.
 */
export type SortKey = "newest" | "cheap" | "expensive" | "rating";

export const SORT_LABELS: Record<SortKey, string> = {
  newest: "جدیدترین",
  cheap: "ارزان‌ترین",
  expensive: "گران‌ترین",
  rating: "بیشترین امتیاز",
};

export function parseSortParam(
  sp: Record<string, string | string[] | undefined>,
): SortKey {
  const s = sp["sort"];
  const val = Array.isArray(s) ? s[0] : s;
  if (val === "cheap" || val === "expensive" || val === "rating") return val;
  return "newest"; // پیش‌فرض: جدیدترین (بند ۲۵ — از createdAt واقعی)
}

/**
 * حداقل چیزی که مقایسهٔ امتیاز لازم دارد — ProductV2 ساختاراً همین را دارد
 * (واردکردن تایپ از ./catalog در این ماژول لازم نیست تا ماژول خالص و تست‌پذیر بماند).
 */
export interface RatableProduct {
  createdAt: string;
  rating?: { avg: number | null; count: number };
}

/** اختلاف کمتر از این مقدار «نیم‌ستاره» حساب نمی‌شود (۴٫۵ و ۴٫۴۷ یک امتیازند) */
const RATING_EPSILON = 0.05;

/**
 * مقایسهٔ «بیشترین امتیاز» (بند ۲۱/۴۱) — تنها منبع این قاعده:
 *  ۱) میانگین نزولی، اما اختلاف < نیم‌ستاره معیار ترتیب نیست
 *  ۲) تعداد نظر نزولی (۵ نظر از ۱ نظر معتبرتر است)
 *  ۳) جدیدترین
 * محصول با rating خالی یا count=0 امتیاز ساختگی نمی‌گیرد و همیشه پایین می‌ماند.
 */
export function compareRating(a: RatableProduct, b: RatableProduct): number {
  const score = (p: RatableProduct) =>
    p.rating && p.rating.count > 0 ? p.rating.avg ?? 0 : -1;
  const diff = score(b) - score(a);
  if (Math.abs(diff) >= RATING_EPSILON) return diff;

  const countOf = (p: RatableProduct) =>
    p.rating && p.rating.count > 0 ? p.rating.count : 0;
  const byCount = countOf(b) - countOf(a);
  if (byCount !== 0) return byCount;

  return +new Date(b.createdAt) - +new Date(a.createdAt);
}
