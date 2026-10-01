/**
 * موج ۱ — API عمومی کاتالوگ: فقط PUBLISHED، قیمت مؤثر کانال website،
 * موجودی واقعی (stockQty − reservedQty)، ماتریس واریانت رنگ/سایز، 404 ناموجود/غیرمنتشر.
 * روی rehearsal اجرا می‌شود؛ ردیف‌های خودش را می‌سازد و پاک می‌کند.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import {
  PublicCatalogController,
  shapeVariants,
  resolveImages,
} from "../src/catalog/public-catalog.controller";

jest.setTimeout(120_000);

describe("Phase 14 wave1 — public catalog", () => {
  let prisma: PrismaService;
  let ctl: PublicCatalogController;
  const created: Array<{ products: string[]; category: string; brand: string; variantSkus: string[]; media: string[] }> = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ctl = new PublicCatalogController(prisma);
  });

  afterAll(async () => {
    // پاکسازی برعکس وابستگی‌ها
    for (const c of created) {
      await prisma.product.deleteMany({ where: { id: { in: c.products } } }).catch(() => undefined);
      await prisma.brand.delete({ where: { id: c.brand } }).catch(() => undefined);
      await prisma.category.delete({ where: { id: c.category } }).catch(() => undefined);
      await prisma.media.deleteMany({ where: { id: { in: c.media } } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  /** دستهٔ موقت با نام یکتا (slug یکتا) */
  const makeCategory = async (tag: string) =>
    prisma.category.create({ data: { name: `تست کاتالوگ ${tag}`, slug: `tc-${tag}`, status: "PUBLISHED" } });

  const makeProduct = async (opts: {
    tag: string; categoryId: string; status?: "PUBLISHED" | "DRAFT";
    basePrice?: bigint; salePrice?: bigint | null; createdAt?: Date;
    stock?: number; reserved?: number; color?: string; size?: string;
  }) => {
    const sku = `TST-${opts.tag}`;
    const product = await prisma.product.create({
      data: {
        name: `محصول تست ${opts.tag}`,
        slug: `tst-${opts.tag}`,
        status: opts.status ?? "PUBLISHED",
        categoryId: opts.categoryId,
        basePrice: opts.basePrice ?? 250_000n,
        publishedAt: new Date(),
        variants: {
          create: {
            sku,
            price: opts.basePrice ?? 250_000n,
            stockQty: opts.stock ?? 5,
            reservedQty: opts.reserved ?? 0,
            status: "PUBLISHED",
            ...(opts.color || opts.size
              ? {
                  terms: {
                    create: [
                      ...(opts.color ? [{ attributeTermId: opts.color }] : []),
                      ...(opts.size ? [{ attributeTermId: opts.size }] : []),
                    ],
                  },
                }
              : {}),
          },
        },
      },
      include: { variants: { include: { terms: true } } },
    });
    // salePrice روی VariantPrice کانال website (سطح قیمتِ کانال)
    if (opts.salePrice != null) {
      const channel = await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "website" } });
      await prisma.variantPrice.create({
        data: { variantSku: sku, priceLevelId: channel.priceLevelId, price: opts.basePrice ?? 250_000n, salePrice: opts.salePrice },
      });
    }
    return product;
  };

  it("categories: فقط PUBLISHED با شمارش واقعی", async () => {
    const cat = await makeCategory(`cat-${Date.now().toString(36)}`);
    created.push({ products: [], category: cat.id, brand: "", variantSkus: [], media: [] });
    const p = await makeProduct({ tag: `c${Date.now().toString(36)}`, categoryId: cat.id });
    created[0].products.push(p.id);
    const draft = await prisma.product.create({
      data: { name: "پیش‌نویس", slug: `tst-draft-${Date.now().toString(36)}`, status: "DRAFT", categoryId: cat.id, basePrice: 100n },
    });
    created[0].products.push(draft.id);

    const r = (await ctl.categories()) as { items: Array<{ slug: string; productCount: number }> };
    const hit = r.items.find((c) => c.slug === cat.slug);
    expect(hit).toBeTruthy();
    expect(hit!.productCount).toBe(1); // فقط منتشرشده
  });

  it("products: فقط منتشرشده + قیمت مؤثر کانال website + موجودی واقعی", async () => {
    const cat = await makeCategory(`lst-${Date.now().toString(36)}`);
    const tag = `L${Date.now().toString(36)}`;
    const p = await makeProduct({ tag, categoryId: cat.id, basePrice: 300_000n, salePrice: 250_000n, stock: 7, reserved: 2 });
    created.push({ products: [p.id], category: cat.id, brand: "", variantSkus: [], media: [] });

    const r = (await ctl.products(undefined, undefined, undefined, undefined, "100")) as { items: Array<{ slug: string; minPrice: number | null; variants: Array<{ salePrice?: number; stock: number; price: number }> }> };
    const hit = r.items.find((x) => x.slug === p.slug);
    expect(hit).toBeTruthy();
    expect(hit!.variants).toHaveLength(1);
    // قیمت مؤثر: پایه از کانال (بدون ردیف price = خود variant)، حراج فعال ۲۵۰
    expect(hit!.variants[0].price).toBe(300_000);
    expect(hit!.variants[0].salePrice).toBe(250_000);
    expect(hit!.variants[0].stock).toBe(5); // 7 − 2 واقعی
    expect(hit!.minPrice).toBe(250_000);
  });

  it("product/:slug: ماتریس رنگ/سایز از ترم‌های واریانت", async () => {
    const cat = await makeCategory(`mtx-${Date.now().toString(36)}`);
    const [colorA, colorB, size75, size80] = await Promise.all([
      prisma.attributeTerm.create({ data: { attributeId: await attrId("color"), value: "رنگ تست الف", slug: `tc-a-${Date.now().toString(36)}`, hex: "#123456", sortOrder: 1 } }),
      prisma.attributeTerm.create({ data: { attributeId: await attrId("color"), value: "رنگ تست ب", slug: `tc-b-${Date.now().toString(36)}`, hex: "#654321", sortOrder: 2 } }),
      prisma.attributeTerm.create({ data: { attributeId: await attrId("size"), value: "تست ۷۵", slug: `ts-75-${Date.now().toString(36)}`, sortOrder: 1 } }),
      prisma.attributeTerm.create({ data: { attributeId: await attrId("size"), value: "تست ۸۰", slug: `ts-80-${Date.now().toString(36)}`, sortOrder: 2 } }),
    ]);
    created[0]?.media.push(); // no-op نگه‌داشتن ساختار
    const tag = `M${Date.now().toString(36)}`;
    const sku1 = `TST-${tag}-A75`;
    const sku2 = `TST-${tag}-B80`;
    const product = await prisma.product.create({
      data: {
        name: "محصول ماتریس", slug: `tst-${tag}`, status: "PUBLISHED", categoryId: cat.id, basePrice: 400_000n, publishedAt: new Date(),
        variants: {
          create: [
            { sku: sku1, price: 400_000n, stockQty: 3, status: "PUBLISHED", terms: { create: [{ attributeTermId: colorA.id }, { attributeTermId: size75.id }] } },
            { sku: sku2, price: 420_000n, stockQty: 1, status: "PUBLISHED", terms: { create: [{ attributeTermId: colorB.id }, { attributeTermId: size80.id }] } },
          ],
        },
      },
      include: { variants: { include: { terms: { include: { term: { include: { attribute: true } } } } } } },
    });
    created.push({ products: [product.id], category: cat.id, brand: "", variantSkus: [sku1, sku2], media: [] });

    const r = (await ctl.product(product.slug)) as {
      variants: Array<{ sku: string; colorId: string | null; sizeId: string | null }>;
    };
    expect(r.variants).toHaveLength(2);
    const a = r.variants.find((v) => v.sku === sku1)!;
    const b = r.variants.find((v) => v.sku === sku2)!;
    expect(a.colorId).toBe(colorA.id);
    expect(a.sizeId).toBe(size75.id);
    expect(b.colorId).toBe(colorB.id);
    expect(b.sizeId).toBe(size80.id);
  });

  it("product/:slug: ناموجود → 404 و غیرمنتشر → 404", async () => {
    await expect(ctl.product("no-such-slug-xyz")).rejects.toMatchObject({
      response: { code: "PRODUCT_NOT_FOUND" },
    });
    const cat = await makeCategory(`dft-${Date.now().toString(36)}`);
    const draft = await prisma.product.create({
      data: { name: "پیش‌نویس نامرئی", slug: `tst-df-${Date.now().toString(36)}`, status: "DRAFT", categoryId: cat.id, basePrice: 100n },
    });
    created.push({ products: [draft.id], category: cat.id, brand: "", variantSkus: [], media: [] });
    await expect(ctl.product(draft.slug)).rejects.toMatchObject({
      response: { code: "PRODUCT_NOT_FOUND" },
    });
  });

  it("shapeVariants/resolveImages: توابع خالص — حراج منقضی نادیده، تصویر یتیم حذف", () => {
    const now = Date.now();
    const priceMap = new Map([
      ["S1", { price: 100n, salePrice: 80n, saleStartsAt: new Date(now - 86_400_000), saleEndsAt: new Date(now + 86_400_000) }],
      ["S2", { price: 200n, salePrice: 150n, saleStartsAt: new Date(now - 2 * 86_400_000), saleEndsAt: new Date(now - 86_400_000) }], // منقضی
    ]);
    const out = shapeVariants(
      [
        { sku: "S1", price: 100n, stockQty: 4, reservedQty: 1, terms: [] },
        { sku: "S2", price: 200n, stockQty: 2, reservedQty: 0, terms: [] },
      ] as never,
      priceMap,
    );
    expect(out[0].salePrice).toBe(80);
    expect(out[0].stock).toBe(3);
    expect(out[1].salePrice).toBeUndefined(); // منقضی → حراج نمایش داده نمی‌شود
    expect(out[1].price).toBe(200);

    const imgs = resolveImages(
      [{ mediaId: "m1", isPrimary: true, sortOrder: 0, alt: null }, { mediaId: "m2", isPrimary: false, sortOrder: 1, alt: null }],
      new Map([["m1", "key1.png"]]),
    );
    expect(imgs).toHaveLength(1); // m2 در Media نیست → حذف
    expect(imgs[0].storageKey).toBe("key1.png");
  });

  /** helper: id اتریبیوت رنگ/سایز (دمو آن‌ها را از قبل دارد) */
  async function attrId(slug: string): Promise<string> {
    const a = await prisma.attribute.findUniqueOrThrow({ where: { slug } });
    return a.id;
  }
});
