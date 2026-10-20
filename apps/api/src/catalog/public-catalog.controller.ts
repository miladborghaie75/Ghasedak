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
  attributeIds: string[];
  /**
   * ترم‌های سطح محصول (جنس و …) با slug و مقدار — ویزارد «چی لازم داری؟» قاعده
   * را با slug می‌سنجد (پایدار)، و فروشگاه برچسب واقعی را از همین‌جا نشان می‌دهد.
   */
  attributeTerms: Array<{ id: string; slug: string; value: string }>;
  createdAt: string;
  image: string | null; images: Array<{ url: string; alt: string | null }>;
  isNew: boolean; inStock: boolean; minPrice: number | null; maxPrice: number | null;
  description?: string | null; tags?: string[];
  /** خلاصهٔ نظرات تأییدشده — فقط APPROVED؛ بدون نظر → count=0/avg=null (بند ۴۱/۸۸) */
  rating?: { avg: number | null; count: number };
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

  /** خلاصهٔ امتیاز نظرات تأییدشدهٔ چند محصول — batch groupBy (بدون N+1) */
  private async ratingMap(productIds: string[]): Promise<Map<string, { avg: number | null; count: number }>> {
    const map = new Map<string, { avg: number | null; count: number }>();
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return map;
    const rows = await this.prisma.review.groupBy({
      by: ["productId"],
      where: { productId: { in: ids }, status: "APPROVED" },
      _count: { _all: true },
      _avg: { rating: true },
    });
    for (const r of rows) {
      map.set(r.productId, {
        avg: r._avg.rating != null ? Math.round(r._avg.rating * 10) / 10 : null,
        count: r._count._all,
      });
    }
    return map;
  }

  /**
   * اتریبیوت‌های سطح محصول (جنس و …) — batch، بدون N+1.
   * کلید = productId، مقدار = ترم‌های محصول با id/slug/value.
   */
  private async productAttributeMap(
    productIds: string[],
  ): Promise<Map<string, Array<{ id: string; slug: string; value: string }>>> {
    const map = new Map<string, Array<{ id: string; slug: string; value: string }>>();
    const ids = [...new Set(productIds.filter(Boolean))];
    if (ids.length === 0) return map;
    const rows = await this.prisma.productAttributeTerm.findMany({
      where: { productId: { in: ids } },
      select: {
        productId: true,
        term: { select: { id: true, slug: true, value: true, sortOrder: true } },
      },
    });
    for (const r of rows) {
      const list = map.get(r.productId) ?? [];
      list.push({ id: r.term.id, slug: r.term.slug, value: r.term.value });
      map.set(r.productId, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.slug.localeCompare(b.slug, "fa"));
    }
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

  /** دسته‌های منتشرشده + شمارش محصول واقعی + آیکون (برای نمایش در فروشگاه) */
  @Get("categories")
  async categories() {
    const rows = await this.prisma.category.findMany({
      where: { deletedAt: null, status: "PUBLISHED" },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, slug: true, name: true, description: true, parentId: true, sortOrder: true,
        iconId: true, imageId: true,
      },
    });
    const counts = await this.prisma.product.groupBy({
      by: ["categoryId"],
      where: { deletedAt: null, status: "PUBLISHED" },
      _count: { _all: true },
    });
    const byCat = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    // آیکون/تصویر دسته → کلید فایل، تا فروشگاه بتواند واقعاً نمایش دهد
    const mediaKeys = await this.mediaKeyMap(rows.map((r) => r.iconId ?? r.imageId).filter((x): x is string => !!x));
    return {
      items: rows.map((r) => {
        const mediaId = r.iconId ?? r.imageId;
        return {
          id: r.id,
          slug: r.slug,
          name: r.name,
          description: r.description,
          parentId: r.parentId,
          sortOrder: r.sortOrder,
          productCount: byCat.get(r.id) ?? 0,
          // اولویت با آیکون؛ اگر نبود تصویر دسته
          imageUrl: mediaId ? (mediaKeys.get(mediaId) ? `/media/${mediaKeys.get(mediaId)}` : null) : null,
          hasIcon: !!r.iconId,
        };
      }),
    };
  }

  /** برندها + لوگو */
  @Get("brands")
  async brands() {
    const rows = await this.prisma.brand.findMany({
      orderBy: { sortOrder: "asc" },
      select: { id: true, slug: true, name: true, logoId: true, description: true },
    });
    const mediaKeys = await this.mediaKeyMap(rows.map((r) => r.logoId).filter((x): x is string => !!x));
    return {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        logoUrl: r.logoId && mediaKeys.get(r.logoId) ? `/media/${mediaKeys.get(r.logoId)}` : null,
      })),
    };
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
    const ratings = await this.ratingMap(rows.map((r) => r.id));
    const attributes = await this.productAttributeMap(rows.map((r) => r.id));
    const items = rows.map((p) => {
    const shaped = shapeCommon(
      { ...p, images: resolveImages(p.images, mediaMap), variants: p.variants.map(flattenVariantTerms) },
      priceMap,
    ) as unknown as ShapedProduct;
      shaped.rating = ratings.get(p.id) ?? { avg: null, count: 0 };
      // اتریبیوت‌های سطح محصول — ویزارد «چی لازم داری؟» و فیلتر جنس به آن نیاز دارند
      const terms = attributes.get(p.id) ?? [];
      shaped.attributeTerms = terms;
      shaped.attributeIds = terms.map((t) => t.id);
      return shaped;
    });
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
    const attributes = await this.productAttributeMap([p.id]);
    const terms = attributes.get(p.id) ?? [];
    shaped.attributeTerms = terms;
    shaped.attributeIds = terms.map((t) => t.id);
    shaped.description = p.description;
    shaped.tags = p.tags;
    // خلاصهٔ نظرات تأییدشدهٔ همین محصول — کارت/لیست و PDP هم‌منبع‌اند (بند ۴۱)
    const ratings = await this.ratingMap([p.id]);
    shaped.rating = ratings.get(p.id) ?? { avg: null, count: 0 };
    return shaped;
  }
}
