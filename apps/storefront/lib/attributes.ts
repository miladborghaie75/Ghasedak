/**
 * مدل اتریبیوت‌های مستقل محصول (بند ۱۶ spec).
 * هر بعد (سایز/فنر/اسفنج/کاپ/جنس/رنگ) یک Attribute با Termهای خودش است.
 * «نوع سوتین» در UI فقط گروه‌بندی بصری فنر+اسفنج+کاپ است (بند ۱۷) —
 * در داده هیچ ترکیبی رخ نمی‌دهد.
 */

export type AttributeKey =
  | "size"
  | "underwire" // فنر
  | "padding" // اسفنج
  | "cup" // کاپ
  | "material" // جنس
  | "color"; // رنگ

export interface AttributeTerm {
  id: string;
  attribute: AttributeKey;
  label: string; // نمایش فارسی
  /** برای سواچ رنگ */
  hex?: string;
  /** ترتیب نمایش */
  order: number;
}

export const ATTRIBUTES: Record<AttributeKey, { label: string }> = {
  size: { label: "سایز" },
  underwire: { label: "فنر" },
  padding: { label: "اسفنج" },
  cup: { label: "کاپ" },
  material: { label: "جنس" },
  color: { label: "رنگ" },
};

const term = (
  id: string,
  attribute: AttributeKey,
  label: string,
  order: number,
  hex?: string,
): AttributeTerm => ({ id, attribute, label, order, hex });

/* ── سایز — سیستمی per-category (بند ۱۶: یک سایز برای همه دسته‌ها فرض نمی‌شود) */
export const SIZE_TERMS: AttributeTerm[] = [
  term("sz-70", "size", "70", 1),
  term("sz-75", "size", "75", 2),
  term("sz-80", "size", "80", 3),
  term("sz-85", "size", "85", 4),
  term("sz-90", "size", "90", 5),
  term("sz-95", "size", "95", 6),
  term("sz-S", "size", "S", 10),
  term("sz-M", "size", "M", 11),
  term("sz-L", "size", "L", 12),
  term("sz-XL", "size", "XL", 13),
];

export const UNDERWIRE_TERMS: AttributeTerm[] = [
  term("uw-yes", "underwire", "فنردار", 1),
  term("uw-no", "underwire", "بدون فنر", 2),
];

export const PADDING_TERMS: AttributeTerm[] = [
  term("pd-yes", "padding", "اسفنج‌دار", 1),
  term("pd-thin", "padding", "اسفنج نازک", 2),
  term("pd-no", "padding", "بدون اسفنج", 3),
];

export const CUP_TERMS: AttributeTerm[] = [
  term("cup-A", "cup", "A", 1),
  term("cup-B", "cup", "B", 2),
  term("cup-C", "cup", "C", 3),
  term("cup-D", "cup", "D", 4),
];

export const MATERIAL_TERMS: AttributeTerm[] = [
  term("mt-cotton", "material", "پنبه", 1),
  term("mt-microfiber", "material", "میکروفایبر", 2),
  term("mt-lace", "material", "تور", 3),
  term("mt-guipure", "material", "گیپور", 4),
  term("mt-modal", "material", "مودال", 5),
];

export const COLOR_TERMS: AttributeTerm[] = [
  term("cl-violet", "color", "بنفش", 1, "#A67DEA"),
  term("cl-lilac", "color", "یاسی", 2, "#D9C6F5"),
  term("cl-rose", "color", "صورتی", 3, "#C9829D"),
  term("cl-cream", "color", "کرم", 4, "#F3E4D3"),
  term("cl-white", "color", "سفید", 5, "#FAFAFA"),
  term("cl-black", "color", "مشکی", 6, "#332C38"),
  term("cl-sage", "color", "سبز مریمی", 7, "#8FA89B"),
];

export const ALL_TERMS: AttributeTerm[] = [
  ...SIZE_TERMS,
  ...UNDERWIRE_TERMS,
  ...PADDING_TERMS,
  ...CUP_TERMS,
  ...MATERIAL_TERMS,
  ...COLOR_TERMS,
];

const termIndex = new Map(ALL_TERMS.map((t) => [t.id, t]));

export function getTerm(id: string): AttributeTerm {
  const t = termIndex.get(id);
  if (!t) throw new Error(`Unknown term: ${id}`);
  return t;
}

export function termsOf(attribute: AttributeKey): AttributeTerm[] {
  return ALL_TERMS.filter((t) => t.attribute === attribute).sort(
    (a, b) => a.order - b.order,
  );
}

/* ── فیلترهای مجاز هر دسته (بند ۱۹) */
export type CategorySlug =
  | "bra"
  | "panty"
  | "set"
  | "shapewear"
  | "sport"
  | "sleepwear";

export const CATEGORY_FILTERS: Record<CategorySlug, AttributeKey[]> = {
  bra: ["size", "cup", "underwire", "padding", "color", "material"],
  set: ["size", "cup", "underwire", "padding", "color", "material"],
  panty: ["size", "color", "material"],
  sport: ["size", "color", "material"],
  sleepwear: ["size", "color", "material"],
  shapewear: ["size", "color", "material"],
};

/** فیلترهای «نوع سوتین» — گروه‌بندی بصری (بند ۱۷) */
export const BRA_TYPE_GROUP: AttributeKey[] = ["underwire", "padding", "cup"];

/** سیاست سایز هر دسته (بند ۱۶ — سایز per-category) */
export const CATEGORY_SIZE_SYSTEM: Record<
  CategorySlug,
  "band" | "letter"
> = {
  bra: "band", // 70..95
  set: "band",
  panty: "letter", // S..XL
  shapewear: "letter",
  sport: "letter",
  sleepwear: "letter",
};

/** کدام دسته‌ها کاپ/فنر/اسفنج دارند */
export const categoryHas = {
  cup: (c: CategorySlug) => c === "bra" || c === "set",
  underwire: (c: CategorySlug) => c === "bra" || c === "set",
  padding: (c: CategorySlug) => c === "bra" || c === "set",
};
