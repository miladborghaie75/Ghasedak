import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
// note: posSearch در پایین — جستجوی فارسی POS
import { nextBarcodeForCategory } from "./barcode.util";
import type { Prisma } from "@prisma/client";

export interface ListQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListQuery): Promise<unknown> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const where: Prisma.ProductWhereInput = { deletedAt: null };
    if (query.q) {
      // جستجوی ترکیبی: نام/slug + SKU + بارکد (بند ۳۶)
      const matchingVariant = await this.prisma.productVariant.findFirst({
        where: { OR: [{ sku: { contains: query.q } }, { barcode: { contains: query.q } }] },
        select: { productId: true },
      });
      where.OR = [
        { name: { contains: query.q } },
        { slug: { contains: query.q } },
        ...(matchingVariant ? [{ id: matchingVariant.productId }] : []),
      ];
    }
    if (query.status) where.status = query.status;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        select: {
          id: true, name: true, slug: true, status: true, basePrice: true,
          createdAt: true, updatedAt: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
          variants: { select: { sku: true, barcode: true, stockQty: true } },
        },
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  /**
   * ایجاد محصول کامل — بند ۱۰: مشخصات، قیمت، فروش ویژه، SEO، تگ، واریانت با SKU/بارکد،
   * ویژگی‌ها (ProductAttributeTerm). همه چیز در یک تراکنش.
   */
  async createFull(data: {
    name: string; slug?: string; shortDescription?: string; description?: string;
    categoryId: string; brandId?: string | null;
    basePrice: number; salePrice?: number | null; saleStartsAt?: string | null; saleEndsAt?: string | null;
    costPrice?: number | null; videoUrl?: string | null; weightGrams?: number | null;
    tags?: string[]; status?: string;
    seo?: { seoTitle?: string; metaDescription?: string; canonical?: string; ogTitle?: string; ogDescription?: string; noindex?: boolean } | null;
    variants?: Array<{ sku: string; barcode?: string | null; price: number; salePrice?: number | null; stockQty?: number; lowStockThreshold?: number; status?: string; weightGrams?: number | null }>;
    attributeTermIds?: string[];
  }): Promise<unknown> {
    if (!data.name?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام محصول الزامی است." });
    if (!Number.isSafeInteger(data.basePrice) || data.basePrice < 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", fieldErrors: { basePrice: ["قیمت باید عدد صحیح تومان باشد"] } });
    }
    const category = await this.prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "دسته یافت نشد." });

    let slug = data.slug?.trim() || data.name.trim().toLowerCase().replace(/[\s\u200c]+/g, "-").replace(/[^a-z0-9\u0600-\u06FF-]/g, "").replace(/-+/g, "-") || `p-${Date.now().toString(36)}`;
    if (await this.prisma.product.findUnique({ where: { slug } })) slug = `${slug}-${Date.now().toString(36)}`;

    // بارکد خودکار بر اساس دسته (بند ۱۱۶: قابل ویرایش بعداً)
    const catRow = await this.prisma.category.findUnique({ where: { id: data.categoryId }, select: { slug: true, id: true, parentId: true } });
    const catSlug = catRow?.parentId ? null : catRow?.slug ?? null; // فقط دسته سطح ۱ کد مستقیم دارد
    const autoBarcode1 = await nextBarcodeForCategory(this.prisma, catSlug, data.categoryId);
    const autoBarcode2 = await nextBarcodeForCategory(this.prisma, catSlug, data.categoryId);

    // یکتایی SKU/بارکد (بند ۱۱۶)
    const skus = (data.variants ?? []).map((v) => v.sku);
    if (new Set(skus).size !== skus.length) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "SKU تکراری در واریانت‌ها." });
    }
    for (const sku of skus) {
      if (await this.prisma.productVariant.findUnique({ where: { sku } })) {
        throw new BadRequestException({ code: "DUPLICATE_SKU", message: `SKU «${sku}» قبلاً ثبت شده است.` });
      }
    }
    // واریانت بدون بارکد → بارکد خودکار دسته‌محور می‌گیرد
    let autoIdx = 0;
    const autoPool = [autoBarcode1, autoBarcode2];
    for (const v of data.variants ?? []) {
      if (v.barcode == null || v.barcode === "") {
        v.barcode = autoPool[autoIdx % autoPool.length];
        autoIdx++;
      }
    }
    const barcodes = (data.variants ?? []).map((v) => v.barcode).filter((b): b is string => !!b);
    for (const bc of barcodes) {
      if (await this.prisma.productVariant.findUnique({ where: { barcode: bc } })) {
        throw new BadRequestException({ code: "DUPLICATE_BARCODE", message: `بارکد «${bc}» قبلاً ثبت شده است.` });
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const seoId = data.seo
        ? (await tx.seoMeta.create({ data: {
            seoTitle: data.seo.seoTitle ?? null,
            metaDescription: data.seo.metaDescription ?? null,
            canonical: data.seo.canonical ?? null,
            ogTitle: data.seo.ogTitle ?? null,
            ogDescription: data.seo.ogDescription ?? null,
            noindex: data.seo.noindex ?? false,
          } })).id
        : null;

      const product = await tx.product.create({
        data: {
          name: data.name.trim(),
          slug,
          shortDescription: data.shortDescription ?? null,
          description: data.description ?? null,
          categoryId: data.categoryId,
          brandId: data.brandId ?? null,
          basePrice: BigInt(data.basePrice),
          salePrice: data.salePrice != null ? BigInt(data.salePrice) : null,
          saleStartsAt: data.saleStartsAt ? new Date(data.saleStartsAt) : null,
          saleEndsAt: data.saleEndsAt ? new Date(data.saleEndsAt) : null,
          costPrice: data.costPrice != null ? BigInt(data.costPrice) : null,
          videoUrl: data.videoUrl ?? null,
          weightGrams: data.weightGrams ?? null,
          tags: data.tags ?? [],
          status: (data.status as never) ?? "DRAFT",
          ...(data.status === "PUBLISHED" ? { publishedAt: new Date() } : {}),
          ...(seoId ? { seoId } : {}),
        },
      });

      // واریانت‌ها (حداقل یکی — اگر خالی، یک واریانت پیش‌فرض از قیمت پایه)
      const variantList = data.variants?.length
        ? data.variants
        : [{ sku: `${slug.toUpperCase().slice(0, 12)}-DEF`, price: data.basePrice }];
      for (const v of variantList) {
        await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: v.sku,
            barcode: v.barcode ?? null,
            price: BigInt(v.price),
            salePrice: v.salePrice != null ? BigInt(v.salePrice) : null,
            stockQty: v.stockQty ?? 0,
            lowStockThreshold: v.lowStockThreshold ?? 3,
            weightGrams: v.weightGrams ?? null,
            status: (v.status as never) ?? "PUBLISHED",
          },
        });
      }

      // ویژگی‌ها
      if (data.attributeTermIds?.length) {
        for (const termId of data.attributeTermIds) {
          const term = await tx.attributeTerm.findUnique({ where: { id: termId } });
          if (term) {
            await tx.productAttributeTerm.create({ data: { productId: product.id, attributeTermId: term.id } }).catch(() => null);
          }
        }
      }
      return product;
    });
  }

  /**
   * جستجوی زنده محصولات برای POS — نام/برند/SKU/بارکد با نرمال‌سازی فارسی
   * (ی/ي، ک/ك، نیم‌فاصله، ارقام فارسی). فقط منتشرشده‌ها؛ حداکثر ۸ نتیجه برای نمایش سریع.
   */
  async posSearch(q: string): Promise<unknown> {
    const norm = (s: string) =>
      s
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/\u064A/g, "\u06CC")
        .replace(/\u0643/g, "\u06A9")
        .replace(/[\u200c\u200f\u200e]/g, " ")
        .trim();
    const query = norm(q ?? "");
    // جستجوی خالی = «انتخاب از لیست محصولات» → همه منتشرشده‌ها
    let idsFromVariants: string[] = [];
    if (query) {
      const variantHit = await this.prisma.productVariant.findMany({
        where: { OR: [{ sku: { contains: query } }, { barcode: { contains: query } }] },
        select: { productId: true },
        take: 8,
      });
      idsFromVariants = [...new Set(variantHit.map((v) => v.productId))];
    }
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        status: "PUBLISHED",
        ...(query
          ? idsFromVariants.length
            ? { id: { in: idsFromVariants } }
            : { name: { contains: query } }
          : {}),
      },
      orderBy: { name: "asc" },
      take: 8,
      select: {
        id: true, name: true, slug: true, basePrice: true, salePrice: true,
        brand: { select: { name: true } },
        variants: {
          where: { status: "PUBLISHED" },
          orderBy: { createdAt: "asc" },
          select: { id: true, sku: true, barcode: true, price: true, salePrice: true, stockQty: true, reservedQty: true },
        },
        images: { orderBy: { sortOrder: "asc" }, take: 1, select: { mediaId: true, alt: true } },
      },
    });
    return { items: products };
  }

  /** جستجوی بارکد/SKU — برای POS و فرم‌های ادمین */
  async lookupByCode(code: string): Promise<unknown> {
    if (!code?.trim()) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کد بارکد/SKU را وارد کنید." });
    }
    const variant = await this.prisma.productVariant.findFirst({
      where: { OR: [{ barcode: code.trim() }, { sku: code.trim() }] },
      include: {
        product: { select: { id: true, name: true, slug: true, status: true, deletedAt: true } },
      },
    });
    if (!variant || variant.product.deletedAt) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "کالایی با این بارکد/SKU یافت نشد." });
    }
    return {
      variant: {
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        price: variant.price,
        salePrice: variant.salePrice,
        stockQty: variant.stockQty,
        reservedQty: variant.reservedQty,
        status: variant.status,
      },
      product: { id: variant.product.id, name: variant.product.name, slug: variant.product.slug, status: variant.product.status },
    };
  }

  /**
   * پیشنهاد SEO — قاعده‌محور از داده واقعی محصول (بدون جعل):
   * title ≤ ۶۰ کاراکتر، meta ۱۲۰–۱۶۰، برند+دسته در عنوان. AI بعداً روی همین API سوار می‌شود.
   */
  async suggestSeo(id: string): Promise<unknown> {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: { category: { select: { name: true } }, brand: { select: { name: true } } },
    });
    if (!p) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });
    const brandPart = p.brand ? ` ${p.brand.name}` : "";
    const seoTitle = `${p.name}${brandPart} | لباس زیر قاصدک`.slice(0, 60);
    const shortDesc = p.shortDescription?.trim();
    const metaDescription = (shortDesc && shortDesc.length >= 50
      ? shortDesc
      : `${p.name}${brandPart} — ${p.category.name} با بهترین کیفیت از لباس زیر قاصدک. ارسال سریع، ضمانت اصالت و قیمت مناسب.`
    ).slice(0, 160);
    return {
      seoTitle,
      metaDescription,
      ogTitle: seoTitle,
      ogDescription: metaDescription.slice(0, 120),
      canonical: `/${p.slug}`,
      source: "rule-based",
    };
  }

  async create(data: {
    name: string; slug?: string; shortDescription?: string; description?: string;
    categoryId: string; brandId?: string; basePrice: number; status?: string;
  }): Promise<unknown> {
    return this.createFull(data);
  }

  async update(id: string, data: Partial<{
    name: string; shortDescription: string; description: string;
    basePrice: number; status: string;
  }>): Promise<unknown> {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });
    return this.prisma.product.update({
      where: { id },
      data: {
        ...("name" in data ? { name: data.name } : {}),
        ...("shortDescription" in data ? { shortDescription: data.shortDescription } : {}),
        ...("description" in data ? { description: data.description } : {}),
        ...("basePrice" in data
          ? {
              basePrice: (() => {
                if (!Number.isSafeInteger(data.basePrice!) || data.basePrice! < 0) {
                  throw new BadRequestException({ code: "VALIDATION_ERROR", message: "قیمت نامعتبر" });
                }
                return BigInt(data.basePrice!);
              })(),
            }
          : {}),
        ...("status" in data ? { status: data.status as never } : {}),
      },
    });
  }

  /** ویرایش کامل محصول — همه فیلدها + واریانت‌ها (بارکد قابل تغییر) + عکس‌ها */
  async updateFull(id: string, data: {
    name?: string; slug?: string; shortDescription?: string; description?: string;
    categoryId?: string; brandId?: string | null; basePrice?: number;
    salePrice?: number | null; saleStartsAt?: string | null; saleEndsAt?: string | null;
    costPrice?: number | null; videoUrl?: string | null; weightGrams?: number | null;
    tags?: string[]; status?: string;
    seo?: { seoTitle?: string; metaDescription?: string; canonical?: string; ogTitle?: string; ogDescription?: string; noindex?: boolean } | null;
    variants?: Array<{ id?: string; sku: string; barcode?: string | null; price: number; salePrice?: number | null; stockQty?: number; lowStockThreshold?: number; status?: string; weightGrams?: number | null; remove?: boolean }>;
    imageMediaIds?: string[];
  }): Promise<unknown> {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });

    return this.prisma.$transaction(async (tx) => {
      const pd: Record<string, unknown> = {};
      if (data.name !== undefined) pd.name = data.name.trim();
      if (data.shortDescription !== undefined) pd.shortDescription = data.shortDescription;
      if (data.description !== undefined) pd.description = data.description;
      if (data.categoryId !== undefined) pd.categoryId = data.categoryId;
      if (data.brandId !== undefined) pd.brandId = data.brandId;
      if (data.basePrice !== undefined) {
        if (!Number.isSafeInteger(data.basePrice) || data.basePrice < 0) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "قیمت نامعتبر" });
        pd.basePrice = BigInt(data.basePrice);
      }
      if (data.salePrice !== undefined) pd.salePrice = data.salePrice != null ? BigInt(data.salePrice) : null;
      if (data.saleStartsAt !== undefined) pd.saleStartsAt = data.saleStartsAt ? new Date(data.saleStartsAt) : null;
      if (data.saleEndsAt !== undefined) pd.saleEndsAt = data.saleEndsAt ? new Date(data.saleEndsAt) : null;
      if (data.costPrice !== undefined) pd.costPrice = data.costPrice != null ? BigInt(data.costPrice) : null;
      if (data.videoUrl !== undefined) pd.videoUrl = data.videoUrl;
      if (data.weightGrams !== undefined) pd.weightGrams = data.weightGrams;
      if (data.tags !== undefined) pd.tags = data.tags;
      if (data.status !== undefined) {
        pd.status = data.status;
        if (data.status === "PUBLISHED" && !product.publishedAt) pd.publishedAt = new Date();
      }

      if (data.seo !== undefined) {
        const seoData = {
          seoTitle: data.seo?.seoTitle ?? null,
          metaDescription: data.seo?.metaDescription ?? null,
          canonical: data.seo?.canonical ?? null,
          ogTitle: data.seo?.ogTitle ?? null,
          ogDescription: data.seo?.ogDescription ?? null,
          noindex: data.seo?.noindex ?? false,
        };
        if (product.seoId) {
          await tx.seoMeta.update({ where: { id: product.seoId }, data: seoData });
        } else {
          const s = await tx.seoMeta.create({ data: seoData });
          pd.seoId = s.id;
        }
      }

      if (Object.keys(pd).length) {
        await tx.product.update({ where: { id }, data: pd });
      }

      // واریانت‌ها — ایجاد/ویرایش/حذف؛ تغییر بارکد مجاز با چک یکتایی (بند ۱۱۶)
      if (data.variants) {
        for (const v of data.variants) {
          if (v.remove && v.id) {
            await tx.productVariant.delete({ where: { id: v.id } }).catch(() => null);
            continue;
          }
          if (v.barcode) {
            const dup = await tx.productVariant.findFirst({ where: { barcode: v.barcode, sku: { not: v.sku } } });
            if (dup) throw new BadRequestException({ code: "DUPLICATE_BARCODE", message: `بارکد «${v.barcode}» برای کالای دیگری ثبت شده است.` });
          }
          const dupSku = await tx.productVariant.findFirst({ where: { sku: v.sku, id: { not: v.id ?? "" } } });
          if (dupSku) throw new BadRequestException({ code: "DUPLICATE_SKU", message: `SKU «${v.sku}» تکراری است.` });
          if (v.id) {
            await tx.productVariant.update({
              where: { id: v.id },
              data: {
                sku: v.sku,
                ...(v.barcode !== undefined ? { barcode: v.barcode || null } : {}),
                price: BigInt(v.price),
                salePrice: v.salePrice != null ? BigInt(v.salePrice) : null,
                ...(v.stockQty !== undefined ? { stockQty: v.stockQty } : {}),
                ...(v.lowStockThreshold !== undefined ? { lowStockThreshold: v.lowStockThreshold } : {}),
                ...(v.status !== undefined ? { status: v.status as never } : {}),
                ...(v.weightGrams !== undefined ? { weightGrams: v.weightGrams } : {}),
              },
            });
          } else {
            await tx.productVariant.create({
              data: {
                productId: id,
                sku: v.sku,
                barcode: v.barcode || null,
                price: BigInt(v.price),
                salePrice: v.salePrice != null ? BigInt(v.salePrice) : null,
                stockQty: v.stockQty ?? 0,
                lowStockThreshold: v.lowStockThreshold ?? 3,
                status: (v.status as never) ?? "PUBLISHED",
              },
            });
          }
        }
      }

      // عکس‌ها — ProductImage با ترتیب؛ اولی primary
      if (data.imageMediaIds) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        for (let i = 0; i < data.imageMediaIds.length; i++) {
          await tx.productImage.create({
            data: { productId: id, mediaId: data.imageMediaIds[i], sortOrder: i, isPrimary: i === 0, alt: data.name ?? null },
          });
        }
      }

      return tx.product.findUnique({ where: { id }, include: { variants: true, images: true } });
    });
  }

  /** جزئیات کامل برای فرم ویرایش */
  async detail(id: string): Promise<unknown> {
    const p = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        variants: { orderBy: { createdAt: "asc" } },
        images: { orderBy: { sortOrder: "asc" } },
        seo: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
    });
    if (!p) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });
    return p;
  }

  /**
   * ماتریس واریانت سایز×رنگ — ترکیب مقادیر دو ویژگی محور واریانت؛
   * SKU/بارکد خودکار پیشنهاد می‌شود (قابل ویرایش بعداً).
   */
  async variantMatrix(id: string, body: { sizeTermIds: string[]; colorTermIds?: string[] }): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { category: { select: { slug: true, id: true, parentId: true } } },
    });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });
    const sizes = body.sizeTermIds ?? [];
    const colors = body.colorTermIds?.length ? body.colorTermIds : [null];
    const existing = await this.prisma.productVariant.findMany({ where: { productId: id }, select: { sku: true } });
    const taken = new Set(existing.map((e) => e.sku));
    const cat = product.category.parentId ? null : product.category.slug;
    const combos: Array<{ sku: string; size?: string; color?: string; barcode: string }> = [];
    for (const size of sizes) {
      for (const color of colors) {
        const termS = size ? await this.prisma.attributeTerm.findUnique({ where: { id: size } }) : null;
        const termC = color ? await this.prisma.attributeTerm.findUnique({ where: { id: color } }) : null;
        let sku = `${product.slug.slice(0, 10).toUpperCase().replace(/-/g, "")}-${termS?.slug ?? "DEF"}${termC ? `-${termC.slug}` : ""}`.slice(0, 40);
        let n = 1;
        while (taken.has(sku)) sku = sku.replace(/\d+$/, "") + n++;
        taken.add(sku);
        const barcode = await nextBarcodeForCategory(this.prisma, cat, product.categoryId);
        combos.push({ sku, size: termS?.value, color: termC?.value, barcode });
      }
    }
    return { combos };
  }

  /** soft delete — بند ۸۹: محصول قابل restore */
  async softDelete(id: string): Promise<void> {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), status: "ARCHIVED" } });
  }
}
