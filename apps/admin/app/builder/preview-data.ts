"use client";

import type { CmsData, CmsProduct } from "@ghasedak/blocks";

/**
 * دادهٔ پیش‌نمایش برای بوم صفحه‌ساز.
 *
 * عمداً همان API عمومی فروشگاه را می‌خواند (`/catalog/products` و
 * `/catalog/categories`) تا بومِ ادمین با سایتِ منتشرشده دادهٔ یکسان ببیند.
 * اگر API در دسترس نباشد، داده خالی است و بلوک‌ها حالت «خالی» صادقانه
 * نشان می‌دهند — هرگز محصول ساختگی نمایش داده نمی‌شود.
 */

interface RawProduct {
  id: string;
  slug: string;
  name: string;
  createdAt?: string;
  variants?: Array<{ price: number; salePrice?: number; stock?: number }>;
}

function toCmsProduct(p: RawProduct): CmsProduct {
  const vs = Array.isArray(p.variants) ? p.variants : [];
  const bases = vs.map((v) => Number(v.price) || 0).filter((n) => n > 0);
  const sales = vs
    .map((v) => (v.salePrice != null ? Number(v.salePrice) : null))
    .filter((n): n is number => n != null && n > 0);

  const base = bases.length ? Math.min(...bases) : 0;
  const sale = sales.length ? Math.min(...sales) : null;
  const onSale = sale != null && sale < base;

  return {
    id: String(p.id ?? p.slug),
    slug: String(p.slug ?? ""),
    name: String(p.name ?? "محصول"),
    price: onSale ? sale! : base,
    compareAt: onSale ? base : null,
    imageUrl: null,
    badge: onSale ? "تخفیف" : null,
    isNew: isRecent(p.createdAt),
    inStock: vs.some((v) => Number(v.stock ?? 0) > 0),
  };
}

/** «جدید» بر اساس ساخت‌شدن در ۶۰ رز اخیر — همان قاعدهٔ فروشگاه */
function isRecent(createdAt?: string): boolean {
  if (!createdAt) return false;
  const t = new Date(createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < 60 * 24 * 60 * 60 * 1000;
}

export async function loadBuilderPreviewData(): Promise<CmsData> {
  const empty: CmsData = { products: [], categories: [], brands: [], guides: [] };
  try {
    const [prodRes, catRes, brandRes] = await Promise.all([
      fetch("/api/catalog/products?per_page=100&page=1", { signal: AbortSignal.timeout(12_000) }),
      fetch("/api/catalog/categories", { signal: AbortSignal.timeout(12_000) }),
      fetch("/api/catalog/brands", { signal: AbortSignal.timeout(12_000) }),
    ]);

    const products: CmsProduct[] = [];
    if (prodRes.ok) {
      const body = (await prodRes.json()) as { items?: RawProduct[] };
      for (const raw of body.items ?? []) products.push(toCmsProduct(raw));
    }

    const categories: CmsData["categories"] = [];
    if (catRes.ok) {
      const body = (await catRes.json()) as {
        items?: Array<{ slug: string; name: string; description?: string | null }>;
      };
      for (const c of body.items ?? []) {
        if (c?.slug && c?.name) categories.push({ slug: c.slug, name: c.name, blurb: c.description ?? undefined });
      }
    }

    const brands: CmsData["brands"] = [];
    if (brandRes.ok) {
      const body = (await brandRes.json()) as {
        items?: Array<{ slug: string; name: string; logoUrl?: string | null }>;
      };
      for (const b of body.items ?? []) {
        if (b?.slug && b?.name) brands.push({ slug: b.slug, name: b.name, logoUrl: b.logoUrl ?? null });
      }
    }

    return { products, categories, brands, guides: [] };
  } catch {
    return empty;
  }
}