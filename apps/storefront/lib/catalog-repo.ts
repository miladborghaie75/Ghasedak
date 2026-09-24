/**
 * Repository v2 — نقطه دسترسی UI به مدل جدید.
 * بند ۵۷: از پروتوتایپ فقط UX حفظ شده؛ داده و منطق بازنویسی شده.
 */
import {
  CATEGORY_FILTERS,
  categoryHas,
  getTerm,
  termsOf,
  type AttributeKey,
  type CategorySlug,
} from "./attributes";
import {
  BRANDS_V2,
  HAS_REAL_DISCOUNTS,
  HAS_REAL_SALES_DATA,
  NEWEST_IDS,
  PRODUCTS_V2,
  type ProductV2,
  type VariantV2,
} from "./catalog";
import { normalizeFa } from "./format";
import type { SortKey } from "./sort";

export {
  BRANDS_V2 as brands,
  NEWEST_IDS,
  HAS_REAL_SALES_DATA,
  HAS_REAL_DISCOUNTS,
};

export const getAllProductsV2 = (): ProductV2[] => PRODUCTS_V2;

export const getProductV2BySlug = (slug: string): ProductV2 | undefined =>
  PRODUCTS_V2.find((p) => p.slug === slug);

export const getProductsByCategoryV2 = (c: CategorySlug): ProductV2[] =>
  PRODUCTS_V2.filter((p) => p.category === c);

export const getBrandV2 = (id: string) => BRANDS_V2.find((b) => b.id === id);

/* ── قیمت */

export const minPrice = (p: ProductV2): number =>
  Math.min(...p.variants.map((v) => v.price));

/**
 * قیمت فروش واقعی محصول — فقط اگر حداقل یک واریانت salePrice پایین‌تر داشته باشد.
 * هیچ تخفیف جعلی تولید نمی‌شود (بند ۲۵/۴۲).
 */
export function salePriceOf(p: ProductV2): number | null {
  const hit = p.variants.find(
    (v) => v.salePrice != null && v.salePrice < v.price,
  );
  return hit ? hit.salePrice! : null;
}

export const hasAnyStock = (p: ProductV2): boolean =>
  p.variants.some((v) => v.stock > 0);

export const isNewProduct = (p: ProductV2): boolean =>
  NEWEST_IDS.includes(p.id);

/* ── سازگاری واریانت (بند ۱۲ و ۴۱) */

/**
 * رنگ‌های قابل انتخاب با درنظرگرفتن سایز انتخاب‌شده (یا برعکس).
 * اگر selectedIds شامل سایز باشد، فقط رنگ‌هایی برمی‌گردند که برای آن سایز
 * واریانت موجود دارند.
 */
export function availableOptionIds(
  product: ProductV2,
  attribute: AttributeKey,
  selected: Partial<Record<AttributeKey, string>>,
): Set<string> {
  const pool = product.variants.filter((v) => v.stock > 0);
  const constrained = pool.filter((v) =>
    (Object.entries(selected) as [AttributeKey, string][]).every(
      ([attr, termId]) => {
        if (!termId) return true;
        if (attr === "color") return v.colorId === termId;
        if (attr === "size") return v.sizeId === termId;
        return v.optionIds.includes(termId);
      },
    ),
  );

  const ids = new Set<string>();
  for (const v of constrained.length ? constrained : pool) {
    if (attribute === "color") ids.add(v.colorId);
    else if (attribute === "size") ids.add(v.sizeId);
    else v.optionIds.forEach((o) => ids.add(o));
  }
  return ids;
}

/** یک واریانت دقیق از ترکیب انتخاب‌ها (یا null اگر ترکیب موجود نیست) */
export function resolveVariant(
  product: ProductV2,
  selected: Partial<Record<AttributeKey, string>>,
): VariantV2 | null {
  return (
    product.variants.find(
      (v) =>
        (!selected.color || v.colorId === selected.color) &&
        (!selected.size || v.sizeId === selected.size) &&
        (Object.entries(selected) as [AttributeKey, string][])
          .filter(([a]) => a !== "color" && a !== "size")
          .every(([, termId]) => v.optionIds.includes(termId)),
    ) ?? null
  );
}

/* ── فیلتر دسته‌آگاه (بند ۱۹) */

export interface FilterStateV2 {
  size: string[];
  cup: string[];
  underwire: string[];
  padding: string[];
  color: string[];
  material: string[];
  brand: string[];
  priceMax?: number;
}

export const emptyFiltersV2: FilterStateV2 = {
  size: [], cup: [], underwire: [], padding: [], color: [], material: [], brand: [],
};

/** ترتیب گروه‌های فیلتر برای دسته — «نوع سوتین» گروه بصری است (بند ۱۷) */
export function filterGroupsFor(category: CategorySlug): AttributeKey[] {
  return CATEGORY_FILTERS[category];
}

export function applyFiltersV2(
  products: ProductV2[],
  f: FilterStateV2,
): ProductV2[] {
  return products.filter((p) => {
    if (f.brand.length && !f.brand.includes(p.brandId)) return false;
    if (
      f.material.length &&
      !f.material.some((m) => p.attributeIds.includes(m))
    )
      return false;
    // بقیه اتریبیوت‌ها روی واریانت
    const vs = p.variants;
    const pass = (predicate: (v: VariantV2) => boolean) => vs.some(predicate);

    if (f.size.length && !pass((v) => f.size.includes(v.sizeId))) return false;
    if (f.color.length && !pass((v) => f.color.includes(v.colorId)))
      return false;
    if (
      f.underwire.length &&
      !pass((v) => f.underwire.some((u) => v.optionIds.includes(u)))
    )
      return false;
    if (
      f.padding.length &&
      !pass((v) => f.padding.some((u) => v.optionIds.includes(u)))
    )
      return false;
    if (
      f.cup.length &&
      !pass((v) => f.cup.some((u) => v.optionIds.includes(u)))
    )
      return false;
    if (f.priceMax != null && minPrice(p) > f.priceMax) return false;
    return true;
  });
}

/** پارس فیلترها از searchParams — سرور-محور (قابل اشتراک‌گذاری در URL) */
export function parseFiltersV2(
  sp: Record<string, string | string[] | undefined>,
): FilterStateV2 {
  const f: FilterStateV2 = {
    size: [], cup: [], underwire: [], padding: [], color: [], material: [], brand: [],
  };
  const get = (key: string): string[] => {
    const v = sp[key];
    return Array.isArray(v) ? v : v ? [v] : [];
  };
  f.size = get("size");
  f.cup = get("cup");
  f.underwire = get("wire");
  f.padding = get("pad");
  f.color = get("color");
  f.material = get("mat");
  f.brand = get("brand");
  const max = get("max")[0];
  if (max) {
    const n = Number(normalizeFa(max).replace(/[^0-9]/g, ""));
    if (!Number.isNaN(n) && n > 0) f.priceMax = n;
  }
  return f;
}

/* ── سورت (بند ۲۱) — بدون جعل محبوبیت */

export function sortV2(list: ProductV2[], sort: SortKey): ProductV2[] {
  const copy = [...list];
  switch (sort) {
    case "newest":
      return copy.sort(
        (a, b) => +new Date(b.createdAt) - +new Date(a.createdAt),
      );
    case "cheap":
      return copy.sort((a, b) => minPrice(a) - minPrice(b));
    case "expensive":
      return copy.sort((a, b) => minPrice(b) - minPrice(a));
  }
}

/* ── جستجو */

export function searchV2(
  query: string,
  pool: ProductV2[] = PRODUCTS_V2,
): ProductV2[] {
  const q = normalizeFa(query);
  if (!q) return [];
  const words = q.split(" ").filter(Boolean);
  return pool.filter((p) => {
    const brand = getBrandV2(p.brandId);
    const hay = normalizeFa(
      [
        p.name,
        p.short,
        brand?.name ?? "",
        ...p.attributeIds.map((id) => getTerm(id).label),
      ].join(" "),
    );
    return words.every((w) => hay.includes(w));
  });
}

/* ── گزینه‌های فیلتر از روی داده واقعی یک دسته */

export function filterOptionsFor(
  category: CategorySlug,
  pool: ProductV2[],
): Partial<Record<AttributeKey, string[]>> {
  const result: Partial<Record<AttributeKey, string[]>> = {};
  for (const attr of filterGroupsFor(category)) {
    if (attr === "color") {
      result.color = [
        ...new Set(pool.flatMap((p) => p.variants.map((v) => v.colorId))),
      ];
    } else if (attr === "size") {
      result.size = [
        ...new Set(pool.flatMap((p) => p.variants.map((v) => v.sizeId))),
      ];
    } else if (attr === "material") {
      result.material = [...new Set(pool.flatMap((p) => p.attributeIds))];
    } else if (categoryHas[attr as keyof typeof categoryHas]?.(category)) {
      result[attr] = [
        ...new Set(pool.flatMap((p) => p.variants.flatMap((v) => v.optionIds))),
      ].filter((id) => {
        try {
          return getTerm(id).attribute === attr;
        } catch {
          return false;
        }
      });
    }
  }
  return result;
}

/** برچسب ترتیب یونیون سایز — نمایش مرتب بر اساس order ترم */
export function sortedTermIds(ids: string[], attribute: AttributeKey): string[] {
  const order = new Map(termsOf(attribute).map((t, i) => [t.id, t.order]));
  return [...ids].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}
