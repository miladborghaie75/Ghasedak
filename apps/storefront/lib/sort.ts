/** ماژول مشترک سرور/کلاینت برای سورت — بدون "use client" */

/** بند ۲۱: «پرفروش‌ترین» تا وقتی داده فروش واقعی نداریم وجود ندارد */
export type SortKey = "newest" | "cheap" | "expensive";

export const SORT_LABELS: Record<SortKey, string> = {
  newest: "جدیدترین",
  cheap: "ارزان‌ترین",
  expensive: "گران‌ترین",
};

export function parseSortParam(
  sp: Record<string, string | string[] | undefined>,
): SortKey {
  const s = sp["sort"];
  const val = Array.isArray(s) ? s[0] : s;
  if (val === "cheap" || val === "expensive") return val;
  return "newest"; // پیش‌فرض: جدیدترین (بند ۲۵ — از createdAt واقعی)
}
