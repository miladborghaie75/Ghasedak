/**
 * Repository v2 — نقطه دسترسی UI به دادهٔ واقعی (فاز ۱۴ موج ۱).
 * قبلاً از دموی استاتیک PRODUCTS_V2 می‌خواند؛ حالا از API عمومی کاتالوگ
 * (`/api/v1/catalog/*`) با همان شکل ProductV2/VariantV2 — هیچ کامپوننتی تغییر نکرده.
 *
 * سازوکار:
 *  - سرور (RSC): fetch از API_ORIGIN با کش ماژول‌سطح + TTL کوتاه؛ خطا → کش کهنه یا خالی
 *    (صفحات در زمان build به بالا بودن API وابسته نیستند — موج ۵ بدون اینترنت build می‌گیرد)
 *  - کلاینت: اگر کش سرور به DOM hydrate شده باشد همان را می‌خواند؛ وگرنه از `/api/proxy/catalog`
 *    بارگذاری تنبل می‌کند (Promise مشترک، بدون شلیک تکراری)
 */
import {
  getTerm,
  type AttributeKey,
  type CategorySlug,
} from "./attributes";
import type { ProductV2 as ProductV2Type, VariantV2 } from "./catalog";
import { resetTermLabels, putTermLabel } from "./term-labels";
import { compareRating, type SortKey } from "./sort";

export type ProductV2 = ProductV2Type;
export type { VariantV2 } from "./catalog";

const TTL_MS = 60_000;
const PROXY_PATH = "/api/proxy/catalog";

interface CatalogSnapshot {
  products: ProductV2[];
  fetchedAt: number;
  stale: boolean;
}

const g = globalThis as unknown as {
  __ghCatalog?: CatalogSnapshot;
  __ghCatalogInflight?: Promise<ProductV2[]>;
};

function apiOrigin(): string {
  return process.env.API_ORIGIN ?? "http://localhost:4000";
}

function toV2(raw: Record<string, unknown>): ProductV2 {
  const variants = (raw.variants ?? []) as Array<Record<string, unknown>>;
  // عکس اصلی — API آن را /api/media/<key> می‌دهد؛ به /media/<key> نرمال می‌شود
  // تا با ریرایت هم‌مبدأ فروشگاه سرو شود (بند ۵۱ — داده دستکاری نمیشود، فقط مسیر)
  const rawImage = (raw.image as string) ?? null;
  const image = rawImage ? rawImage.replace(/^\/api\/media\//, "/media/") : null;
  return {
    id: String(raw.id),
    slug: String(raw.slug),
    name: String(raw.name),
    category: (raw.category ?? "") as CategorySlug,
    brandId: (raw.brandId as string) ?? null,
    short: (raw.short as string) ?? "",
    attributeIds: (raw.attributeIds as string[]) ?? [],
    /** ترم‌های سطح محصول (جنس و …) — slug + مقدار واقعی برای ویزارد و متن دلیل */
    attributeTerms: (raw.attributeTerms as ProductV2["attributeTerms"]) ?? [],
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    image,
    // خلاصهٔ نظرات تأییدشده — API همیشه می‌فرستد؛ فقط وقتی نظر هست ستاره می‌خشد
    rating: (raw.rating as ProductV2["rating"]) ?? undefined,
    variants: variants.map((v) => {
      const out: VariantV2 = {
        id: String(v.id),
        sku: String(v.sku),
        price: Number(v.price),
        stock: Number(v.stock),
        colorId: (v.colorId as string) ?? "",
        sizeId: (v.sizeId as string) ?? "",
        optionIds: (v.optionIds as string[]) ?? [],
        /** برچسب ترم‌های واقعی DB — از API می‌آید و در رجیستری ثبت می‌شود */
        termLabels: (v.termLabels as Record<string, string>) ?? {},
      };
      if (v.salePrice != null) out.salePrice = Number(v.salePrice);
      return out;
    }),
  };
}

/**
 * سقف ایمنی پیمایش صفحات — فقط برای جلوگیری از حلقهٔ بی‌پایان در پاسخ خراب سرور.
 * قبلاً حلقه بی‌قید در ۱۰ صفحه (۱۰۰۰ محصول) متوقف می‌شد و بی‌صدا بقیهٔ کاتالوگ را
 * می‌انداخت؛ نتیجه این بود که مرتب‌سازی «بیشترین امتیاز» روی کاتالوگ بزرگ‌تر از سقف
 * بی‌آنکه کسی بفهمد نادرست می‌شد. از این پس تا تمام‌شدن hasMore می‌رویم و اگر به سقف
 * ایمنی برسیم، صریحاً هشدار می‌دهیم (خطای دیدنی، نه برش خاموش).
 */
const MAX_CATALOG_PAGES = 50; // ۵۰۰۰ محصول

async function fetchAllProducts(): Promise<ProductV2[]> {
  const origin = apiOrigin();
  const out: ProductV2[] = [];
  const perPage = 100;
  for (let page = 1; page <= MAX_CATALOG_PAGES; page++) {
    const res = await fetch(`${origin}/api/v1/catalog/products?per_page=${perPage}&page=${page}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`catalog http ${res.status}`);
    const body = (await res.json()) as { items: Array<Record<string, unknown>>; hasMore: boolean };
    for (const it of body.items) out.push(toV2(it));
    if (!body.hasMore) return out; // کاتالوگ کامل خوانده شد
    if (body.items.length === 0) break; // پاسخ ناسازگار (hasMore بدون آیتم) — حلقه نزن
  }
  console.warn(
    `[catalog] پیمایش در ${MAX_CATALOG_PAGES} صفحه متوقف شد و ممکن است بخشی از کاتالوگ نیامده باشد؛ ` +
      "مرتب‌سازی/شمارش روی همین فهرست ناقص انجام می‌شود — سقف پیمایش یا per_page را بازبینی کن.",
  );
  return out;
}

/** سرور — خواندن با TTL؛ خطا → stale-while-error؛ هرگز throw نمی‌کند (build-safe) */
export async function loadCatalog(): Promise<ProductV2[]> {
  const cached = g.__ghCatalog;
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached.products;
  if (g.__ghCatalogInflight) return g.__ghCatalogInflight;
  const task = (async () => {
    try {
      const products = await fetchAllProducts();
      g.__ghCatalog = { products, fetchedAt: Date.now(), stale: false };
      return products;
    } catch {
      if (cached) return cached.products; // کش کهنه بهتر از خالی است
      return [];
    } finally {
      g.__ghCatalogInflight = undefined;
    }
  })();
  g.__ghCatalogInflight = task;
  return task;
}

/** کلاینت — hydrate از سرور یا بارگذاری تنبل از proxy؛ Promise مشترک */
export function hydrateCatalog(products: ProductV2[]): void {
  // رجیستری برچسب ترم‌ها از همین payload پر می‌شود (سرور و کلاینت) تا UI
  // به‌جای شناسهٔ خام، نام واقعی ترم را نشان دهد (باگ موج ۱)
  resetTermLabels();
  for (const p of products) {
    for (const v of p.variants) {
      for (const [tid, label] of Object.entries(v.termLabels ?? {})) {
        putTermLabel(tid, label);
      }
    }
    // ترم‌های سطح محصول (جنس و …) هم برچسب واقعی دارند — وگرنه متن دلیل ویزارد
    // شناسهٔ خام نشان می‌دهد
    for (const t of p.attributeTerms ?? []) {
      putTermLabel(t.id, t.value);
    }
  }
  if (!g.__ghCatalog || g.__ghCatalog.products.length === 0) {
    g.__ghCatalog = { products, fetchedAt: Date.now(), stale: false };
  }
}

export async function ensureCatalogClient(): Promise<ProductV2[]> {
  const cached = g.__ghCatalog;
  // TTL کلاینت: موجودی/قیمت بعد از خرید نباید تا ابد کهنه بماند — هر ۶۰ ثانیه تازه شود
  if (cached && cached.products.length > 0 && Date.now() - cached.fetchedAt < TTL_MS) return cached.products;
  if (g.__ghCatalogInflight) return g.__ghCatalogInflight;
  const task = (async () => {
    try {
      const res = await fetch(PROXY_PATH, { signal: AbortSignal.timeout(8_000) });
      if (res.ok) {
        const body = (await res.json()) as { items: Array<Record<string, unknown>> };
        const products = body.items.map(toV2);
        hydrateCatalog(products);
        // hydrateCatalog فقط کش خالی را می‌نویسد — اینجا همیشه تازه‌سازی می‌کنیم
        g.__ghCatalog = { products, fetchedAt: Date.now(), stale: false };
        return products;
      }
    } catch { /* آفلاین/خطا — کش کهنه بهتر از خالی است */ }
    return cached?.products ?? [];
  })();
  g.__ghCatalogInflight = task;
  return task;
}

/* ── همان API قبلی repo — همه همگام و بر اساس کش ── */

export const getAllProductsV2 = (): ProductV2[] => g.__ghCatalog?.products ?? [];

export const getProductV2BySlug = (slug: string): ProductV2 | undefined =>
  getAllProductsV2().find((p) => p.slug === slug);

export const getProductsByCategoryV2 = (c: CategorySlug): ProductV2[] =>
  getAllProductsV2().filter((p) => p.category === c);

/** برند بر اساس slug — از محصولات واقعی مشتق می‌شود */
export const getBrandV2 = (id: string | null) => {
  if (!id) return undefined; // محصول بدون برند — هیچ برچسبی نساز (باگ «— null» عنوان PDP)
  const hit = getAllProductsV2().find((p) => p.brandId === id);
  return hit ? { id, slug: id, name: id } : undefined;
};

export const minPrice = (p: ProductV2): number =>
  Math.min(...p.variants.map((v) => v.salePrice ?? v.price));

export function salePriceOf(p: ProductV2): number | null {
  const sales = p.variants.map((v) => v.salePrice).filter((s): s is number => s != null);
  return sales.length ? Math.min(...sales) : null;
}

export const hasAnyStock = (p: ProductV2): boolean => p.variants.some((v) => v.stock > 0);

/** بج «جدید» از createdAt — بدون NEWEST_IDS جعلی (بند ۲۵) */
export const isNewProduct = (p: ProductV2): boolean =>
  Date.now() - new Date(p.createdAt).getTime() <= 30 * 86_400_000;

/* ── سازگاری واریانت (بند ۱۲ و ۴۱) — بدون تغییر ── */

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

/* ── فیلتر دسته‌آگاه (بند ۱۹) — بدون تغییر ── */

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

export function filterGroupsFor(category: CategorySlug): AttributeKey[] {
  const groups: Record<string, AttributeKey[]> = {
    bra: ["size", "cup", "underwire", "padding", "color", "material"],
    set: ["size", "cup", "underwire", "padding", "color", "material"],
    panty: ["size", "color", "material"],
    shapewear: ["size", "color"],
    sport: ["size", "color", "material"],
    sleepwear: ["size", "color", "material"],
  };
  return groups[category] ?? ["size", "color"];
}

export function applyFiltersV2(
  products: ProductV2[],
  f: FilterStateV2,
): ProductV2[] {
  return products.filter((p) => {
    if (f.brand.length && !f.brand.includes(p.brandId ?? "")) return false;
    if (f.material.length && !f.material.some((m) => p.attributeIds.includes(m))) return false;
    const vs = p.variants;
    const pass = (predicate: (v: VariantV2) => boolean) => vs.some(predicate);
    if (f.size.length && !pass((v) => f.size.includes(v.sizeId))) return false;
    if (f.color.length && !pass((v) => f.color.includes(v.colorId))) return false;
    if (f.underwire.length && !pass((v) => f.underwire.some((u) => v.optionIds.includes(u)))) return false;
    if (f.padding.length && !pass((v) => f.padding.some((u) => v.optionIds.includes(u)))) return false;
    if (f.cup.length && !pass((v) => f.cup.some((u) => v.optionIds.includes(u)))) return false;
    if (f.priceMax != null && minPrice(p) > f.priceMax) return false;
    return true;
  });
}

/** پارس فیلترها از searchParams — قابل اشتراک‌گذاری در URL */
export function parseFiltersV2(
  sp: Record<string, string | string[] | undefined>,
): FilterStateV2 {
  const pick = (k: string): string[] => {
    const v = sp[k];
    if (!v) return [];
    return Array.isArray(v) ? v : v.split(",").filter(Boolean);
  };
  const priceMaxRaw = sp.priceMax;
  const priceMax = typeof priceMaxRaw === "string" && priceMaxRaw !== "" ? Number(priceMaxRaw) : undefined;
  return {
    size: pick("size"),
    cup: pick("cup"),
    underwire: pick("underwire"),
    padding: pick("padding"),
    color: pick("color"),
    material: pick("material"),
    brand: pick("brand"),
    ...(priceMax != null && Number.isFinite(priceMax) ? { priceMax } : {}),
  };
}

export function sortV2(list: ProductV2[], sort: SortKey): ProductV2[] {
  const arr = [...list];
  switch (sort) {
    case "cheap":
      return arr.sort((a, b) => minPrice(a) - minPrice(b));
    case "expensive":
      return arr.sort((a, b) => minPrice(b) - minPrice(a));
    case "newest":
      return arr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    case "rating":
      // قاعدهٔ مقایسه در lib/sort.ts است (تک‌منبع، تست‌واحد دارد) —
      // اینجا فقط اعمال می‌شود تا UI و تست از یک قاعده پیروی کنند.
      return arr.sort(compareRating);
    default:
      return arr;
  }
}

export function searchV2(
  q: string,
  pool: ProductV2[] = getAllProductsV2(),
): ProductV2[] {
  const term = q.trim().toLowerCase();
  if (!term) return pool;
  return pool.filter(
    (p) =>
      p.name.toLowerCase().includes(term) ||
      p.short?.toLowerCase().includes(term),
  );
}

/** گزینه‌های فیلتر دسته‌آگاه — امضای اصلی repo حفظ شده */
export function filterOptionsFor(
  category: CategorySlug,
  pool: ProductV2[],
): Partial<Record<AttributeKey, string[]>> {
  const result: Partial<Record<AttributeKey, string[]>> = {};
  for (const attr of filterGroupsFor(category)) {
    if (attr === "color") {
      result.color = [...new Set(pool.flatMap((p) => p.variants.map((v) => v.colorId)))];
    } else if (attr === "size") {
      result.size = [...new Set(pool.flatMap((p) => p.variants.map((v) => v.sizeId)))];
    } else if (attr === "material") {
      result.material = [...new Set(pool.flatMap((p) => p.attributeIds))];
    } else {
      result[attr] = [
        ...new Set(pool.flatMap((p) => p.variants.flatMap((v) => v.optionIds))),
      ].filter((id) => getTerm(id)?.attribute === attr);
    }
  }
  return result;
}
