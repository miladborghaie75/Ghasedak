/**
 * دادهٔ نظرات عمومی (گام ۱۱) — RSC از API می‌خواند؛ storefront مستقیم DB را لمس نمی‌کند.
 * نمایش فقط APPROVED و بدون PII است (موبایل هرگز از API عمومی برنمی‌گردد).
 */

const API = () => process.env.API_ORIGIN ?? "http://localhost:4000";

export interface PublicReviewItem {
  id: string;
  name: string;
  rating: number;
  body: string;
  isVerifiedPurchase: boolean;
  adminReply: string | null;
  createdAt: string;
}

export interface ReviewsData {
  found: boolean;
  summary: { count: number; avg: number | null; stars: number[] } | null;
  items: PublicReviewItem[];
}

/** fetch سمت سرور با no-store — بعد از تأیید ادمین باید فوراً دیده شود */
export async function loadReviews(slug: string): Promise<ReviewsData | null> {
  try {
    const res = await fetch(`${API()}/api/v1/reviews/product/${encodeURIComponent(slug)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ReviewsData;
  } catch {
    return null; // داده در دسترس نیست → بخش مخفی/حالت خطا؛ PDP نمی‌شکند
  }
}
