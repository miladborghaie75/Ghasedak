import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, forwardRef } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
// note: posSearch در پایین — جستجوی فارسی POS
import { nextBarcodeForCategory } from "./barcode.util";
import { GL, GL_EQUITY, slugifyFa, isReservedSlug, ensureUniqueSlug } from "@ghasedak/contracts";
import { JournalService } from "../accounting/journal.service";
import { assertCleanFields } from "../common/text-guard";
import type { Prisma } from "@prisma/client";

/**
 * یک نمونهٔ `JournalService` برای استفادهٔ خارج از DI (تست‌ها).
 *
 * تست‌ها `ProductsService` را مستقیم می‌سازند و Nest در آنجا نیست؛ برای
 * اینکه تست بتواند مسیر «سند موجودی آغازین» را هم بسنجد، این کمکی را
 * می‌دهند. در اپ واقعی همیشه سرویس تزریق‌شده استفاده می‌شود.
 */
export function standaloneProductsService(prisma: PrismaService): ProductsService {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { JournalService } = require("../accounting/journal.service") as {
    JournalService: new (p: PrismaService) => JournalService;
  };
  return new ProductsService(prisma, new JournalService(prisma));
}

export interface ListQuery {
  page?: number;
  limit?: number;
  q?: string;
  status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * سند حسابداری موجودی آغازین (شکاف ۱ — فاز ۲).
     *
     * `forwardRef` + `@Inject(JournalService)` لازم است چون وابستگی حلقوی
     * داریم (محصولات ↔ حسابداری) و Nest بدون این، `design:paramtypes` را
     * نمی‌تواند در ماژول‌های تازه‌ساخته حل کند.
     *
     * نکتهٔ مهم: اول این را با یک `interface` و `@Optional()` نوشتم. کامپایل می‌شد
     * ولی در runtime مقدار `undefined` تزریق می‌شد و سند **بی‌صدا** نمی‌خورد —
     * یعنی موجودی در دفتر انبار می‌نشست ولی در دفتر مالی نه. دقیقاً همان باگی
     * که دنبالش بودیم، فقط پنهان. برای همین اینجا نه `@Optional()` می‌گذاریم و
     * نه رابطه: اگر تزریق شکست بخورد، بوت باید Loud بماند نه اینکه سند حذف شود.
     */
    @Inject(forwardRef(() => JournalService)) private readonly journal: JournalService,
  ) {}

  /**
 * واریانت‌هایی که موجودی دارند ولی سند حسابداری موجودی‌شان ثبت نشده.
 *
 * علت نبود سند معمولاً «بهای خرید ثبت نشده» است — و مبلغ ساختگی در دفتر از
 * نبود سند بدتر است، پس سند نمی‌زنیم ولی گزارش می‌دهیم تا مدیر بها را وارد کند.
 */
  async openingWithoutJournal(): Promise<string[]> {
    const variants = await this.prisma.productVariant.findMany({
      where: { product: { deletedAt: null }, stockQty: { gt: 0 } },
      select: {
        sku: true,
        product: {
          select: { costPrice: true },
        },
      },
    });
    // واریانت‌هایی که اصلاً ردیف «موجودی آغازین» در دفتر انبار ندارند
    const withOpening = await this.prisma.stockLedgerEntry.findMany({
      where: { type: "OPENING" },
      select: { variantSku: true },
    });
    const opened = new Set(withOpening.map((o) => o.variantSku));
    return variants
      .filter((v) => !opened.has(v.sku))
      .map((v) => v.sku);
  }

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
    tags?: string[]; status?: string; actorId?: string;
    seo?: { seoTitle?: string; metaDescription?: string; canonical?: string; ogTitle?: string; ogDescription?: string; noindex?: boolean } | null;
    variants?: Array<{ sku: string; barcode?: string | null; price: number; salePrice?: number | null; stockQty?: number; lowStockThreshold?: number; status?: string; weightGrams?: number | null; termIds?: string[] }>;
    attributeTermIds?: string[];
  }): Promise<unknown> {
    if (!data.name?.trim()) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نام محصول الزامی است." });
    // متن خراب (U+FFFD/کنترلی) همان لحظهٔ نوشتن رد می‌شود — گام F0-3.
    // پیش‌تر چنین ورودی‌ای ذخیره می‌شد و نام محصول به U+FFFD و اسلاگ به `-`
    // فرو می‌ریخت (دو ردیف منتشرشده در کاتالوگ عمومی).
    assertCleanFields({
      name: data.name,
      slug: data.slug,
      shortDescription: data.shortDescription,
      description: data.description,
      seoTitle: data.seo?.seoTitle,
      metaDescription: data.seo?.metaDescription,
      ogTitle: data.seo?.ogTitle,
      ogDescription: data.seo?.ogDescription,
    });
    if (!Number.isSafeInteger(data.basePrice) || data.basePrice < 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", fieldErrors: { basePrice: ["قیمت باید عدد صحیح تومان باشد"] } });
    }
    // قیمت حراج نباید از قیمت پایه بیشتر یا منفی باشد
    if (data.salePrice != null && (!Number.isSafeInteger(data.salePrice) || data.salePrice < 0 || data.salePrice > data.basePrice)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", fieldErrors: { salePrice: ["قیمت حراج باید عدد صحیح بین ۰ تا قیمت پایه باشد"] } });
    }
    const category = await this.prisma.category.findUnique({ where: { id: data.categoryId } });
    if (!category) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "دسته یافت نشد." });

    // اسلاگ از تک‌منبع مشترک (contracts/persian): نرمال‌سازی فارسی + رزرو + یکتایی.
    // اسلاگ دستیِ مدیر: تکرار/رزرو → خطای 409 صریح فارسی (بدون سکوت و بدون پسوند عجیب)؛
    // اسلاگ خودکار از نام: پس‌وند -۲/-۳ می‌گیرد تا ساخت محصول با تکرار نشکند.
    let slug: string;
    if (data.slug != null && String(data.slug).trim() !== "") {
      slug = slugifyFa(data.slug);
      if (!slug) {
        throw new BadRequestException({ code: "VALIDATION_ERROR", message: "اسلاگ باید حداقل یک کاراکتر معتبر داشته باشد." });
      }
      if (isReservedSlug(slug)) {
        throw new ConflictException({ code: "SLUG_RESERVED", message: `«${slug}» یک مسیر رزروی سایت است و نمی‌تواند اسلاگ باشد.` });
      }
      if (await this.prisma.product.findUnique({ where: { slug }, select: { id: true } })) {
        throw new ConflictException({ code: "SLUG_DUPLICATE", message: `اسلاگ «${slug}» قبلاً برای محصول دیگری ثبت شده است.` });
      }
    } else {
      const base = slugifyFa(data.name) || `p-${Date.now().toString(36)}`;
      if (isReservedSlug(base)) {
        throw new ConflictException({ code: "SLUG_RESERVED", message: `«${base}» یک مسیر رزروی سایت است و نمی‌تواند اسلاگ باشد.` });
      }
      slug = await ensureUniqueSlug(base, (candidate) =>
        this.prisma.product.findUnique({ where: { slug: candidate }, select: { id: true } }).then((r) => r !== null),
      );
    }

    // بارکد خودکار بر اساس دسته (بند ۱۱۶: قابل ویرایش بعداً) —
    // به تعداد واریانت‌های بدون بارکد، پشت‌سرهم و یکتا (باگ قبلی: هر دو واریانت یک بارکد می‌گرفتند)
    const catRow = await this.prisma.category.findUnique({ where: { id: data.categoryId }, select: { slug: true, id: true, parentId: true } });
    const catSlug = catRow?.parentId ? null : catRow?.slug ?? null; // فقط دسته سطح ۱ کد مستقیم دارد
    const needsAutoBarcode = (data.variants ?? []).some((v) => v.barcode == null || v.barcode === "");
    // اولین بارکد کاندید — بقیه داخل tx بعد از هر insert صادر می‌شوند تا سریال جلو برود
    const firstAutoBarcode = needsAutoBarcode
      ? await nextBarcodeForCategory(this.prisma, catSlug, data.categoryId)
      : null;

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
      // بارکد خودکار: اولی از قبل؛ دومی به‌بعد داخل tx صادر می‌شود تا یکتا بماند (باگ تکرار بارکد)
      const variantList = data.variants?.length
        ? data.variants
        : [{ sku: `${slug.toUpperCase().slice(0, 12)}-DEF`, price: data.basePrice }];
      // اعتبارسنجی حراج هر واریانت — حراج نباید از قیمت خود واریانت بیشتر باشد
      for (const v of variantList) {
        if (!Number.isSafeInteger(v.price) || v.price < 0) {
          throw new BadRequestException({ code: "VALIDATION_ERROR", message: `قیمت واریانت «${v.sku}» نامعتبر است.` });
        }
        if (v.salePrice != null && (!Number.isSafeInteger(v.salePrice) || v.salePrice < 0 || v.salePrice > v.price)) {
          throw new BadRequestException({ code: "VALIDATION_ERROR", message: `قیمت حراج واریانت «${v.sku}» باید بین ۰ تا قیمت آن باشد.` });
        }
      }
      let nextAuto = firstAutoBarcode;
      // جمع ارزش موجودی آغازین برای سند حسابداری (شکاف ۱ — فاز ۲)
      let openingValue = 0;
      /** واریانت‌هایی که بهای خرید ندارند؛ سندشان صادقانه رد می‌شود */
      const noCostSkus: string[] = [];
      for (const v of variantList) {
        if ((v.barcode == null || v.barcode === "") && nextAuto) {
          v.barcode = nextAuto;
        }
        const openingQty = v.stockQty ?? 0;
        const createdVariant = await tx.productVariant.create({
          data: {
            productId: product.id,
            sku: v.sku,
            barcode: v.barcode ?? null,
            price: BigInt(v.price),
            salePrice: v.salePrice != null ? BigInt(v.salePrice) : null,
            stockQty: openingQty,
            lowStockThreshold: v.lowStockThreshold ?? 3,
            weightGrams: v.weightGrams ?? null,
            status: (v.status as never) ?? "PUBLISHED",
          },
        });
        // اتصال به مقادیر ویژگی (سایز/رنگ/…) — بدون این، محور واریانت در
        // فروشگاه هیچ‌وقت ساخته نمی‌شود.
        if (v.termIds?.length) {
          const real = await tx.attributeTerm.findMany({ where: { id: { in: v.termIds } }, select: { id: true } });
          if (real.length) {
            await tx.variantTerm.createMany({
              data: real.map((t) => ({ variantId: createdVariant.id, attributeTermId: t.id })),
              skipDuplicates: true,
            });
          }
        }
        // موجودی آغازین فقط در stockQty ماندنی نیست (باگ موج ۱: سفارش چنین محصولی
        // چون دفتر انبار خالی بود با INSUFFICIENT_STOCK رد می‌شد) — OPENING داخل همان tx.
        if (openingQty > 0) {
          const w = await tx.warehouse.findFirst({
            // `isDefault` اولویت دارد؛ قبلاً فقط قدیمی‌ترین انبار انتخاب می‌شد
            // و انتخاب مدیر در پنل بی‌اثر بود.
            where: { active: true },
            orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
          });
          if (!w) throw new BadRequestException({ code: "VALIDATION_ERROR", message: "انبار پیش‌فرض یافت نشد؛ ابتدا انبار بسازید." });
          const idem = `opening:${v.sku}`;
          const dup = await tx.stockLedgerEntry.findUnique({ where: { idempotencyKey: idem } });
          if (dup) {
            throw new BadRequestException({ code: "DUPLICATE_SKU", message: `SKU «${v.sku}» قبلاً موجودی آغازین ثبت کرده است.` });
          }
          await tx.stockLedgerEntry.create({
            data: {
              warehouseId: w.id,
              variantSku: v.sku,
              type: "OPENING",
              qtyIn: openingQty,
              balanceBefore: 0,
              balanceAfter: openingQty,
              refType: "opening",
              refId: product.id,
              idempotencyKey: idem,
              note: `موجودی آغازین — ایجاد محصول «${product.name}»`,
            },
          });

          /**
           * سند حسابداری موجودی آغازین (شکاف ۱ از ۹ — فاز ۲).
           *
           * قبلاً این ردیف فقط در `stockQty` و دفتر انبار می‌نشست، ولی **هیچ سندی
           * نمی‌زد**. نتیجه: حساب ۱۲۰۰ از صفر شروع می‌شد و هر فروشی آن را
           * منفی می‌کرد (روی دیتابیس توسعه ماندهٔ ۱۲۰۰ = ‎−۳٬۰۰۰٬۰۰۰ رسید).
           * یعنی ترازنامه ارزش موجودی را نشان نمی‌داد.
           *
           * Dr 1200 موجودی کالا / Cr 3900 سود و زیان انباشته (سرمایه اولیه).
           * اگر بهای خرید ثبت نشده باشد سند زده نمی‌شود — چون مبلغ ساختگی در
           * دفتر، از نبودِ سند بدتر است. آن حالت در پاسخ گزارش می‌شود.
           */
          const unitCost = data.costPrice != null ? Number(data.costPrice) : null;
          if (unitCost != null && unitCost > 0) {
            const value = openingQty * unitCost;
            // جمع ارزش همهٔ واریانت‌های این محصول را بعد از حلقه می‌زنیم؛
            // اینجا فقط برای هر واریانت سهمش نگه داشته می‌شود.
            openingValue += value;
          } else {
            noCostSkus.push(v.sku);
          }
        }
        // بارکد بعدی برای واریانت بعدیِ بدون بارکد — بعد از insert فعلی (سریال جلو می‌رود)
        const remaining = variantList.slice(variantList.indexOf(v) + 1).filter((x) => x.barcode == null || x.barcode === "").length;
        if (remaining > 0) {
          nextAuto = await nextBarcodeForCategory(tx, catSlug, data.categoryId);
        }
      }

      /**
       * سند موجودی آغازین — یک سند برای کل محصول (نه یکی به‌ازای هر واریانت،
       * چون سندهای تکراری دفتر را بی‌فایده می‌کنند).
       */
      let openingJournalPosted = false;
      if (openingValue > 0 && this.journal) {
        await this.journal.postOrNotifyInTx(tx, {
          description: `موجودی آغازین — «${product.name}» (${variantList.length} واریانت)`,
          sourceType: "opening_inventory",
          sourceId: product.id,
          actorId: data.actorId ?? undefined,
          lines: [
            { accountCode: GL.INVENTORY, debit: openingValue },
            { accountCode: GL_EQUITY.RETAINED_EARNINGS, credit: openingValue },
          ],
        });
        openingJournalPosted = true;
      }

      /**
       * گزارش صادقانه به مدیر.
       *
       * اگر موجودی وارد شده ولی سند نخورده، دلیلش نبودِ «بهای خرید» است.
       * پنهان‌کردن این باعث می‌شد مدیر فکر کند همه‌چیز در دفتر است در حالی که
       * ارزش موجودی در ترازنامه غایب می‌ماند.
       */
      const openingWarning =
        variantList.some((v) => (v.stockQty ?? 0) > 0) && !openingJournalPosted
          ? "موجودی آغازین ثبت شد ولی سند حسابداری آن زده نشد، چون «بهای خرید» محصول خالی است. برای دیده‌شدن ارزش موجودی در دفتر، بهای خرید را وارد کنید."
          : null;

      // ویژگی‌ها
      if (data.attributeTermIds?.length) {
        for (const termId of data.attributeTermIds) {
          const term = await tx.attributeTerm.findUnique({ where: { id: termId } });
          if (term) {
            await tx.productAttributeTerm.create({ data: { productId: product.id, attributeTermId: term.id } }).catch(() => null);
          }
        }
      }
      return { ...product, openingJournalPosted, openingWarning };
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

  /**
   * کاتالوگ-پیکر فرم‌های ادمین (فاکتور خرید/فروش) — بند ۲۷/۳۳:
   * جستجوی نام/SKU/بارکد با نرمال‌سازی فارسی؛ واریانت‌های همه وضعیت‌ها (خرید قبل از انتشار).
   * شامل بهای آخرین خرید (costPrice محصول) برای پیش‌پرکردن فاکتور — فقط ادمین.
   */
  async pickerSearch(q: string, limit: number): Promise<unknown> {
    const norm = (s: string) =>
      s
        .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
        .replace(/\u064A/g, "\u06CC")
        .replace(/\u0643/g, "\u06A9")
        .replace(/[\u200c\u200f\u200e]/g, " ")
        .trim();
    const query = norm(q);
    let idsFromVariants: string[] = [];
    if (query) {
      const variantHit = await this.prisma.productVariant.findMany({
        where: { OR: [{ sku: { contains: query } }, { barcode: { contains: query } }] },
        select: { productId: true },
        take: limit,
      });
      idsFromVariants = [...new Set(variantHit.map((v) => v.productId))];
    }
    const products = await this.prisma.product.findMany({
      where: {
        deletedAt: null,
        ...(query
          ? idsFromVariants.length
            ? { id: { in: idsFromVariants } }
            : { name: { contains: query } }
          : {}),
      },
      orderBy: { name: "asc" },
      take: limit,
      select: {
        id: true, name: true, slug: true, status: true, basePrice: true, costPrice: true,
        category: { select: { name: true } },
        brand: { select: { name: true } },
        variants: {
          orderBy: [{ status: "asc" }, { createdAt: "asc" }],
          select: { id: true, sku: true, barcode: true, price: true, salePrice: true, stockQty: true, status: true },
        },
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
    assertCleanFields({ name: data.name, shortDescription: data.shortDescription, description: data.description });
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
    variants?: Array<{ id?: string; sku: string; barcode?: string | null; price: number; salePrice?: number | null; stockQty?: number; lowStockThreshold?: number; status?: string; weightGrams?: number | null; remove?: boolean; termIds?: string[] }>;
    imageMediaIds?: string[];
  }): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      // دسته لازم است تا بارکد خودکارِ واریانت‌های جدید با کد درست دسته ساخته شود
      include: { category: { select: { slug: true, parentId: true } } },
    });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });

    // همان گارد متن خراب روی ویرایش کامل (نام/توضیحات/SEO) — F0-3
    assertCleanFields({
      name: data.name,
      slug: data.slug,
      shortDescription: data.shortDescription,
      description: data.description,
      seoTitle: data.seo?.seoTitle,
      metaDescription: data.seo?.metaDescription,
      ogTitle: data.seo?.ogTitle,
      ogDescription: data.seo?.ogDescription,
    });

    return this.prisma.$transaction(async (tx) => {
      const pd: Record<string, unknown> = {};
      /** موجودی و بهای قبلی هر واریانت — برای تشخیص «افزای» و ارزش‌گذاری سند */
      const prevStock = new Map<string, number>();
      const beforeVariantCost = new Map<string, number>();
      let openingValue = 0;
      const noCostSkus: string[] = [];
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
          // موجودی قبلی — قبل از نوشتن، تا «افزای» تشخیص داده شود.
          // بها فقط روی `Product` است (واریانت فیلد costPrice ندارد).
          if (v.id) {
            const prev = await tx.productVariant.findUnique({
              where: { id: v.id },
              select: { stockQty: true },
            });
            if (prev) {
              prevStock.set(v.id, prev.stockQty);
              beforeVariantCost.set(
                v.id,
                data.costPrice != null
                  ? Number(data.costPrice)
                  : product.costPrice != null
                    ? Number(product.costPrice)
                    : 0,
              );
            }
          }
          if (v.barcode) {
            const dup = await tx.productVariant.findFirst({ where: { barcode: v.barcode, sku: { not: v.sku } } });
            if (dup) throw new BadRequestException({ code: "DUPLICATE_BARCODE", message: `بارکد «${v.barcode}» برای کالای دیگری ثبت شده است.` });
          }
          const dupSku = await tx.productVariant.findFirst({ where: { sku: v.sku, id: { not: v.id ?? "" } } });
          if (dupSku) throw new BadRequestException({ code: "DUPLICATE_SKU", message: `SKU «${v.sku}» تکراری است.` });

          // شناسهٔ ترم‌های ویژگی (سایز/رنگ/…) — این اتصال تاکنون اصلاً نوشته نمی‌شد،
          // برای همین فروشگاه هیچ‌وقت محور رنگ/سایز واقعی نداشت.
          const termIds = Array.isArray(v.termIds) ? v.termIds.filter((t): t is string => typeof t === "string") : null;

          let variantId = v.id;
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
            // بارکد خالی یعنی «خودکار بساز» — فقط همین‌جا شمارهٔ یکتا صادر می‌شود
            let barcode = v.barcode || null;
            if (!barcode) {
              const cat = product.category.parentId ? null : product.category.slug;
              barcode = await nextBarcodeForCategory(tx as never, cat, product.categoryId);
            }
            const created = await tx.productVariant.create({
              data: {
                productId: id,
                sku: v.sku,
                barcode,
                price: BigInt(v.price),
                salePrice: v.salePrice != null ? BigInt(v.salePrice) : null,
                stockQty: v.stockQty ?? 0,
                lowStockThreshold: v.lowStockThreshold ?? 3,
                status: (v.status as never) ?? "PUBLISHED",
              },
            });
            variantId = created.id;
          }

          // اتصال واریانت به مقادیر ویژگی — جایی که قبلاً کلاً فراموش شده بود
          if (termIds && variantId) {
            await tx.variantTerm.deleteMany({ where: { variantId } });
            if (termIds.length) {
              const real = await tx.attributeTerm.findMany({ where: { id: { in: termIds } }, select: { id: true } });
              const ids = real.map((t) => t.id);
              if (ids.length) {
                await tx.variantTerm.createMany({
                  data: ids.map((termId) => ({ variantId, attributeTermId: termId })),
                  skipDuplicates: true,
                });
              }
            }
          }

          /**
           * افزای موجودی در ویرایش محصول هم باید سند بخورد (شکاف ۱ — فاز ۲).
           *
           * قبلاً `stockQty` مستقیم نوشته می‌شد، پس دفتر انبار و دفتر مالی دو
           * عدد متفاوت می‌شدند. آن هم پایین‌تر از سطح انبار است و باید از مسیر
           * انبار (ADJUSTMENT) برود، نه اینکه یک‌طرفه بنویسیم.
           *
           * فقط **افزایش** سند می‌خورد؛ کاهش هم باید از مسیر انبارگردانی/تعدیل
           * بیاید تا تأیید و ممیزی داشته باشد.
           */
          if (v.stockQty !== undefined && v.id) {
            const before = prevStock.get(v.id);
            if (before != null && v.stockQty > before) {
              const delta = v.stockQty - before;
              const w = await tx.warehouse.findFirst({
                where: { active: true },
                orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
              });
              const cost =
                data.costPrice != null ? Number(data.costPrice) : (beforeVariantCost.get(v.id) ?? 0);
              if (w) {
                const last = await tx.stockLedgerEntry.findFirst({
                  where: { warehouseId: w.id, variantSku: v.sku },
                  orderBy: { id: "desc" },
                });
                await tx.stockLedgerEntry.create({
                  data: {
                    warehouseId: w.id,
                    variantSku: v.sku,
                    type: "ADJUSTMENT",
                    qtyIn: delta,
                    // موجودی در دفتر انبار Int است (کمیت)، نه BigInt
                    balanceBefore: last?.balanceAfter ?? before,
                    balanceAfter: before + delta,
                    refType: "product_update",
                    refId: id,
                    idempotencyKey: `prod-open:${id}:${v.sku}:${v.stockQty}`,
                    note: `افزای موجودی با ویرایش محصول (+${delta})`,
                  },
                });
              }
              if (cost > 0) {
                openingValue += delta * cost;
              } else {
                noCostSkus.push(v.sku);
              }
            }
          }
        }
      }

      // سند افزایش موجودی (اگر اتفاق افتاده باشد)
      let openingJournalPosted = false;
      if (openingValue > 0 && this.journal) {
        await this.journal.postOrNotifyInTx(tx, {
          description: `افزای موجودی با ویرایش محصول «${data.name ?? product.name ?? id}»`,
          sourceType: "opening_inventory",
          sourceId: id,
          lines: [
            { accountCode: GL.INVENTORY, debit: openingValue },
            { accountCode: GL_EQUITY.RETAINED_EARNINGS, credit: openingValue },
          ],
        });
        openingJournalPosted = true;
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

      const updated = await tx.product.findUnique({ where: { id }, include: { variants: true, images: true } });
      return {
        ...updated,
        openingJournalPosted,
        openingWarning:
          noCostSkus.length > 0 && !openingJournalPosted
            ? "افزای موجودی در دفتر انبار ثبت شد ولی سند مالی آن زده نشد، چون «بهای خرید» خالی است."
            : null,
      };
    });
  }

  /** جزئیات کامل برای فرم ویرایش */
  async detail(id: string): Promise<unknown> {
    const p = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: {
        // `terms` لازم است تا فرم ویرایش بتواند مقادیر انتخاب‌شدهٔ هر واریانت را
        // دوباره نشان دهد؛ بدون آن، ویرایش محصول مقادیر ویژگی‌ها را پاک می‌کرد.
        variants: {
          orderBy: { createdAt: "asc" },
          include: {
            terms: { include: { term: { include: { attribute: { select: { id: true, name: true, slug: true } } } } } },
          },
        },
        images: { orderBy: { sortOrder: "asc" } },
        seo: true,
        category: { select: { id: true, name: true } },
        brand: { select: { id: true, name: true } },
      },
    });
    if (!p) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });
    // مسیر `term` را به `termId` هم تخت می‌کنیم تا فرم ساده بماند
    return {
      ...p,
      variants: p.variants.map((v) => ({
        ...v,
        termIds: v.terms.map((t) => t.attributeTermId),
        terms: undefined,
      })),
    };
  }

/**
   * ماتریس واریانت از روی ویژگی‌های تعریف‌شده.
   *
   * کاربر در ادمین ویژگی‌ها را از قبل ساخته (مثلاً «نوع سوتین» با مقادیر
   * جک‌دار/ساده، «سایز» با ۷۰ تا ۸۵، «رنگ» با قرمز/آبی/…) و اینجا ترکیب
   * آن‌ها را می‌سازد. یعنی دیگر لازم نیست SKU را دستی تایپ کند.
   *
   * دو نکته که قبلاً اشتباه بود و اینجا درست شده:
   *  ۱) پیشنهاد باید **شناسهٔ ترم** را برگرداند، نه فقط برچسبش؛ وگرنه ساخت
   *     واقعی واریانت ممکن نبود چون `VariantTerm` به id نیاز دارد.
   *  ۲) پیشنهاد نباید بارکد واقعی بسوزاند. قبلاً برای هر ترکیب یک شمارهٔ
   *     یکتا از دیتابیس رزرو می‌شد و بعد دور ریخته می‌شد — یعنی با هر
   *     بار کلیک روی «ساخت ماتریس»، شماره‌ها هدر می‌رفتند. حالا بارکد فقط در
   *     لحظهٔ ساخت واقعی صادر می‌شود.
   *
   * `axes` هر کدام یک ویژگی است و `termIds` مقادیر انتخاب‌شدهٔ آن.
   */
  async variantMatrix(
    id: string,
    body: {
      axes?: Array<{ attributeId: string; termIds: string[] }>;
      /** برای سازگاری با کلاینت قدیمی که فقط سایز×رنگ می‌فرستاد */
      sizeTermIds?: string[];
      colorTermIds?: string[];
    },
  ): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id, deletedAt: null },
      include: { category: { select: { slug: true, id: true, parentId: true } } },
    });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });

    // نرمال‌سازی ورودی: مسیر جدید (axes) یا مسیر قدیمی (size×color)
    const axesInput: Array<{ attributeId: string; termIds: string[] }> =
      body.axes?.filter((a) => a && Array.isArray(a.termIds) && a.termIds.length > 0) ?? [];
    if (axesInput.length === 0 && (body.sizeTermIds?.length || body.colorTermIds?.length)) {
      const bySlug: Record<string, string> = {};
      if (body.sizeTermIds?.length) bySlug.size = body.sizeTermIds[0];
      // شناسهٔ ویژگی را از روی ترم‌ها پیدا می‌کنیم
      const allTermIds = [...(body.sizeTermIds ?? []), ...(body.colorTermIds ?? [])];
      if (allTermIds.length) {
        const terms = await this.prisma.attributeTerm.findMany({
          where: { id: { in: allTermIds } },
          select: { id: true, attributeId: true, attribute: { select: { slug: true } } },
        });
        for (const slug of ["size", "color"]) {
          const ids = terms.filter((t) => t.attribute.slug === slug).map((t) => t.id);
          if (ids.length) axesInput.push({ attributeId: terms[0]?.attributeId ?? "", termIds: ids });
        }
      }
      void bySlug;
    }

    if (axesInput.length === 0) {
      return { combos: [], axes: [] };
    }

    // اعتبارسنجی: ترم‌ها باید واقعی و متعلق به ویژگی خودشان باشند
    const allTermIds = axesInput.flatMap((a) => a.termIds);
    const terms = await this.prisma.attributeTerm.findMany({
      where: { id: { in: allTermIds } },
      include: { attribute: { select: { id: true, name: true, slug: true } } },
    });
    const termById = new Map(terms.map((t) => [t.id, t]));

    const axes = axesInput
      .map((a) => ({
        attributeId: a.attributeId,
        attributeName: termById.get(a.termIds[0])?.attribute.name ?? a.attributeId,
        attributeSlug: termById.get(a.termIds[0])?.attribute.slug ?? "",
        terms: a.termIds
          .map((tid) => termById.get(tid))
          .filter((t): t is NonNullable<typeof t> => !!t)
          .map((t) => ({ id: t.id, value: t.value, slug: t.slug, hex: t.hex })),
      }))
      .filter((a) => a.terms.length > 0);

    if (axes.length === 0) return { combos: [], axes: [] };

    // سقف ترکیب‌ها — ۵ محور × ۲۰ مقدار می‌شود ۳٫۲ میلیارد ترکیب
    const combos: Array<{ terms: Array<{ termId: string; value: string; attributeName: string }>; sku: string; price: string }> = [];
    const cartesian = (i: number, acc: Array<{ termId: string; value: string; attributeName: string }>) => {
      if (combos.length >= 500) return;
      if (i === axes.length) {
        combos.push({ terms: [...acc], sku: "", price: String(product.basePrice) });
        return;
      }
      for (const t of axes[i].terms) {
        acc.push({ termId: t.id, value: t.value, attributeName: axes[i].attributeName });
        cartesian(i + 1, acc);
        acc.pop();
      }
    };
    cartesian(0, []);

    // SKU پیشنهادی از نام محصول + اسلاگ ترم‌ها (انگلیسی برای خوانایی)
    const existing = await this.prisma.productVariant.findMany({ where: { productId: id }, select: { sku: true } });
    const taken = new Set(existing.map((e) => e.sku));
    const base = product.slug.slice(0, 8).toUpperCase().replace(/-/g, "") || "VAR";
    for (const c of combos) {
      const suffix = c.terms
        .map((t) => termById.get(t.termId)?.slug ?? "")
        .filter(Boolean)
        .join("-")
        .slice(0, 20);
      let sku = `${base}-${suffix}`.slice(0, 40);
      let n = 1;
      while (taken.has(sku)) sku = `${base}-${suffix}-${n++}`.slice(0, 40);
      taken.add(sku);
      c.sku = sku;
    }

    // ⚠ دیگر barCode رزرو نمی‌کنیم — فقط هنگام ساخت واقعی صادر می‌شود
    void product.category;
    return {
      axes,
      combos,
      price: String(product.basePrice),
      cat: product.category.parentId ? null : product.category.slug,
    };
  }

  /** soft delete — بند ۸۹: محصول قابل restore */
  async softDelete(id: string): Promise<void> {
    const product = await this.prisma.product.findFirst({ where: { id, deletedAt: null } });
    if (!product) throw new NotFoundException({ code: "NOT_FOUND", message: "محصول یافت نشد." });
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), status: "ARCHIVED" } });
  }
}
