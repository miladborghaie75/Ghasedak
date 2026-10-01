import { Controller, Get, NotFoundException, Param, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * API عمومی کاتالوگ — منبع واحد فروشگاه (فاز ۱۴ موج ۱: اتصال فروشگاه به دادهٔ واقعی).
 * بدون احراز هویت (فروشگاه عمومی است)؛ فقط PUBLISHED؛ قیمت مؤثر از کانال فروشگاه
 * با همان منطق متمرکز PricingService (بند ۱۰۹) — اینجا فقط-خواندنی و batch.
 * شکل پاسخ عمداً با ProductV2/VariantV2 فروشگاه یکی است تا UI بدون تغییر کار کند.
 */

const NEW_WINDOW_DAYS = 30; // بج «جدید» فقط از createdAt (بند ۲۵)

export type ShapedVariant = {
  id: string; sku: string; price: number; salePrice?: number;
  stock: number; colorId: string | null; sizeId: string | null; optionIds: string[];
};

export type ShapedProduct = {
  id: string; slug: string; name: string; short: string | null;
  category: string | null; brandId: string | null;
  attributeIds: string[]; createdAt: string;
  image: string | null; images: Array<{ url: string; alt: string | null }>;
  isNew: boolean; inStock: boolean; minPrice: number | null; maxPrice: number | null;
  description?: string | null; tags?: string[];
  variants: ShapedVariant[];
};

const VARIANT_SELECT = {
  sku: true, price: true, stockQty: true, reservedQty: true,
  terms: { select: { attributeTermId: true, term: { select: { id: true, slug: true, value: true, hex: true, sortOrder: true, attribute: { select: { slug: true, isVariantAxis: true } } } } } },
} as const;

type TermRow = { id: string; slug: string; value: string; hex: string | null; sortOrder: number; attribute: { slug: string; isVariantAxis: boolean } };

type VariantRow = {
  sku: string; price: bigint; stockQty: number; reservedQty: number;
  terms: TermRow[];
};

/** فروش اصالتاً از رنگ/سایز/اختیاری‌ها — اول term های دسته‌محور، بعد سایر اکسس‌ها */
export function splitTerms(terms: VariantRow["terms"]) {
  const sorted = [...terms].sort((a, b) => a.sortOrder - b.sortOrder);
  let color: VariantRow["terms"][number] | undefined;
  let size: VariantRow["terms"][number] | undefined;
  const extras: VariantRow["terms"] = [];
  for (const t of sorted) {
    if (!color && t.attribute.slug === "color") { color = t; continue; }
    if (!size && t.attribute.slug === "size") { size = t; continue; }
    extras.push(t);
  }
  return { color, size, extras };
}

/** واریانت‌های یک محصول را با قیمت کانال شکل می‌دهد — بدون N+1 (نقشهٔ قیمت از قبل) */
export function shapeVariants(
  variants: VariantRow[],
  priceMap: Map<string, { price: bigint; salePrice: bigint | null; saleStartsAt: Date | null; saleEndsAt: Date | null }>,
): ShapedVariant[] {
  const now = Date.now();
  return variants.map((v) => {
    const vp = priceMap.get(v.sku);
    const basePrice = Number(vp ? vp.price : v.price);
    let salePrice: number | null = null;
    const rawSale = vp ? vp.salePrice : null;
    if (rawSale != null) {
      const from = vp ? vp.saleStartsAt : null;
      const to = vp ? vp.saleEndsAt : null;
      const active = (!from || from.getTime() <= now) && (!to || to.getTime() >= now);
      if (active) salePrice = Number(rawSale);
    }
    const { color, size, extras } = splitTerms(v.terms);
    return {
      id: v.sku, sku: v.sku, price: basePrice,
      ...(salePrice != null && salePrice < basePrice ? { salePrice } : {}),
      stock: Math.max(v.stockQty - v.reservedQty, 0),
      colorId: color?.id ?? null, sizeId: size?.id ?? null,
      optionIds: extras.map((t) => t.id),
    };
  });
}

export interface ImageRow { isPrimary: boolean; sortOrder: number; alt: string | null; storageKey: string }

export interface ProductRow {
  id: string; slug: string; name: string; shortDescription: string | null; createdAt: Date;
  category: { slug: string } | null; brand: { slug: string } | null;
  images: ImageRow[]; variants: VariantRow[];
}

/** ProductImage فقط mediaId دارد (بدون رابطه) — join دستی batch به Media */
export function resolveImages(
  images: Array<{ mediaId: string; isPrimary: boolean; sortOrder: number; alt: string | null }>,
  mediaMap: Map<string, string>,
): ImageRow[] {
  return images
    .map((i) => ({ isPrimary: i.isPrimary, sortOrder: i.sortOrder, alt: i.alt, storageKey: mediaMap.get(i.mediaId) ?? "" }))
    .filter((i) => i.storageKey !== "");
}

export function shapeCommon(p: ProductRow, priceMap: Map<string, { price: bigint; salePrice: bigint | null; saleStartsAt: Date | null; saleEndsAt: Date | null }>) {
  const variants = shapeVariants(p.variants, priceMap);
  const imgs = [...p.images].sort((a, b) => (a.isPrimary === b.isPrimary ? a.sortOrder - b.sortOrder : a.isPrimary ? -1 : 1));
  const prices = variants.map((v) => v.salePrice ?? v.price);
  return {
    id: p.id, slug: p.slug, name: p.name, short: p.shortDescription,
    category: p.category?.slug ?? null, brandId: p.brand?.slug ?? null,
    createdAt: p.createdAt.toISOString(),
    image: imgs[0] ? `/api/media/${imgs[0].storageKey}` : null,
    images: imgs.map((i) => ({ url: `/api/media/${i.storageKey}`, alt: i.alt })),
    isNew: Date.now() - p.createdAt.getTime() <= NEW_WINDOW_DAYS * 86_400_000,
    inStock: variants.some((v) => v.stock > 0),
    minPrice: prices.length ? Math.min(...prices) : null,
    maxPrice: prices.length ? Math.max(...prices) : null,
    /** برچسب ترم‌های هر واریانت — UI فروشگاه بدون جدول استاتیک، نام واقعی ترم را نشان دهد */
    variants: variants.map((v, i) => {
      const row = p.variants[i];
      const termLabels: Record<string, string> = {};
      for (const t of row.terms) termLabels[t.id] = t.value;
      return { ...v, termLabels };
    }),
  };
}

type PriceRow = { variantSku: string; price: bigint; salePrice: bigint | null; saleStartsAt: Date | null; saleEndsAt: Date | null };

/** تخت‌کردن ردیف‌های VariantTerm (رابطهٔ term) به TermRow مستقیم */
export function flattenVariantTerms<
  V extends { sku: string; price: bigint; stockQty: number; reservedQty: number; terms: Array<{ attributeTermId: string; term: TermRow }> },
>(v: V): VariantRow {
  return { sku: v.sku, price: v.price, stockQty: v.stockQty, reservedQty: v.reservedQty, terms: v.terms.map((t) => t.term) };
}

@Controller("catalog")
export class PublicCatalogController {
  constructor(private readonly prisma: PrismaService) {}

  /** نقشهٔ قیمت کانال برای لیست SKUها — همان منبع حقیقت PricingService؛ batch و بدون N+1 */
  private async channelPriceMap(skus: string[], channelSlug: string): Promise<Map<string, PriceRow>> {
    const map = new Map<string, PriceRow>();
    if (skus.length === 0) return map;
    const channel = await this.prisma.salesChannel.findUnique({ where: { slug: channelSlug }, select: { priceLevelId: true, active: true } });
    if (!channel || !channel.active) return map;
    const rows = await this.prisma.variantPrice.findMany({
      where: { variantSku: { in: skus }, priceLevelId: channel.priceLevelId },
      select: { variantSku: true, price: true, salePrice: true, saleStartsAt: true, saleEndsAt: true },
    });
    for (const r of rows) map.set(r.variantSku, r);
    return map;
  }

  /** mediaId → storageKey برای تصاویر چند محصول — batch */
  private async mediaKeyMap(mediaIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const ids = [...new Set(mediaIds.filter(Boolean))];
    if (ids.length === 0) return map;
    const rows = await this.prisma.media.findMany({ where: { id: { in: ids } }, select: { id: true, storageKey: true } });
    for (const r of rows) map.set(r.id, r.storageKey);
    return map;
  }

  /** دسته‌های منتشرشده + شمارش محصول واقعی */
  @Get("categories")
  async categories() {
    const rows = await this.prisma.category.findMany({
      where: { deletedAt: null, status: "PUBLISHED" },
      orderBy: { sortOrder: "asc" },
      select: { id: true, slug: true, name: true, description: true, parentId: true, sortOrder: true },
    });
    const counts = await this.prisma.product.groupBy({
      by: ["categoryId"],
      where: { deletedAt: null, status: "PUBLISHED" },
      _count: { _all: true },
    });
    const byCat = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    return { items: rows.map((r) => ({ ...r, productCount: byCat.get(r.id) ?? 0 })) };
  }

  @Get("brands")
  async brands() {
    const rows = await this.prisma.brand.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, slug: true, name: true },
    });
    return { items: rows };
  }

  /** لیست محصولات منتشرشده — فیلتر دسته/برند/جست‌وجو + صفحه‌بندی */
  @Get("products")
  async products(
    @Query("category") category?: string,
    @Query("brand") brand?: string,
    @Query("q") q?: string,
    @Query("page") page?: string,
    @Query("per_page") perPage?: string,
    @Query("channel") channelQ?: string,
  ) {
    const channelSlug = channelQ && /^[a-z0-9-]{1,40}$/.test(channelQ) ? channelQ : "website";
    const take = Math.min(Math.max(Number(perPage) || 60, 1), 100);
    const pageNum = Math.max(Number(page) || 1, 1);
    const skip = (pageNum - 1) * take;
    const where = {
      deletedAt: null as null,
      status: "PUBLISHED" as const,
      ...(category ? { category: { slug: category, deletedAt: null, status: "PUBLISHED" as const } } : {}),
      ...(brand ? { brand: { slug: brand } } : {}),
      ...(q && q.trim()
        ? { OR: [{ name: { contains: q.trim() } }, { shortDescription: { contains: q.trim() } }] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take,
        select: {
          id: true, slug: true, name: true, shortDescription: true, createdAt: true,
          category: { select: { slug: true } },
          brand: { select: { slug: true } },
          images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], take: 1, select: { mediaId: true, isPrimary: true, sortOrder: true, alt: true } },
          variants: { where: { deletedAt: null, status: "PUBLISHED" }, select: VARIANT_SELECT },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    const priceMap = await this.channelPriceMap(rows.flatMap((r) => r.variants.map((v) => v.sku)), channelSlug);
    const mediaMap = await this.mediaKeyMap(rows.flatMap((r) => r.images.map((i) => i.mediaId)));
    const items = rows.map((p) => shapeCommon(
      { ...p, images: resolveImages(p.images, mediaMap), variants: p.variants.map(flattenVariantTerms) },
      priceMap,
    ));
    return { items, page: pageNum, perPage: take, total, hasMore: skip + rows.length < total };
  }

  /** جزئیات محصول با ماتریس واریانت کامل — منبع PDP فروشگاه */
  @Get("products/:slug")
  async product(@Param("slug") slug: string, @Query("channel") channelQ?: string) {
    const channelSlug = channelQ && /^[a-z0-9-]{1,40}$/.test(channelQ) ? channelQ : "website";
    const p = await this.prisma.product.findFirst({
      where: { slug, deletedAt: null, status: "PUBLISHED" },
      select: {
        id: true, slug: true, name: true, shortDescription: true, description: true, createdAt: true, tags: true,
        category: { select: { slug: true } },
        brand: { select: { slug: true } },
        images: { orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }], select: { mediaId: true, isPrimary: true, sortOrder: true, alt: true } },
        variants: { where: { deletedAt: null, status: "PUBLISHED" }, select: VARIANT_SELECT },
      },
    });
    if (!p) throw new NotFoundException({ code: "PRODUCT_NOT_FOUND", message: "محصول یافت نشد." });
    const priceMap = await this.channelPriceMap(p.variants.map((v) => v.sku), channelSlug);
    const mediaMap = await this.mediaKeyMap(p.images.map((i) => i.mediaId));
    const shaped = shapeCommon(
      { ...p, images: resolveImages(p.images, mediaMap), variants: p.variants.map(flattenVariantTerms) },
      priceMap,
    ) as unknown as ShapedProduct;
    // اتریبیوت‌های سطح محصول (جنس و …) — برای فیلتر material و نمایش
    const productTerms = await this.prisma.productAttributeTerm.findMany({
      where: { productId: p.id },
      select: { attributeTermId: true },
    });
    shaped.attributeIds = productTerms.map((t) => t.attributeTermId);
    shaped.description = p.description;
    shaped.tags = p.tags;
    return shaped;
  }
}
