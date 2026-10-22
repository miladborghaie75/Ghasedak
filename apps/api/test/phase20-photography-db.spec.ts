/**
 * گام ۲۰ — برنامهٔ عکاسی روی DB واقعی (rehearsal).
 *
 * چرا این تست جدا از تستِ منطقی؟ چون «جایگزینیِ آرت با عکسِ واقعی» سه چیز را
 * هم‌زمان به هم می‌دوزد:
 *  ۱) نوشتن در جدولِ تازهٔ PhotoTask (و یکتایی «محصول × کادر»),
 *  ۲) نوشتن در ProductImage با فلگِ isPrimary (که فروشگاه از آن می‌خواند),
 *  ۳) خواندنِ همان فلگ از سوی کاتالوگ عمومی.
 * اگر (۲) یا (۳) در DB واقعی درست نباشد، آرت در سایت می‌ماند یا برعکس عکسِ نیم‌کاره
 * جای آرت را می‌گیرد — و این با تستِ ساختگی (fake) معلوم نمی‌شود.
 *
 * دادهٔ این تست فقط در DB آزمایشی (rehearsal) ساخته و پاک می‌شود؛ گاردِ
 * jest.setup اجازهٔ اجرا روی Production را نمی‌دهد.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { PhotographyService } from "../src/photography/photography.service";
import { shapeCommon, resolveImages, flattenVariantTerms } from "../src/catalog/public-catalog.controller";

jest.setTimeout(120_000);

describe("Phase 20 — برنامهٔ عکاسی (DB واقعی)", () => {
  let prisma: PrismaService;
  let service: PhotographyService;
  const tag = Date.now().toString(36);
  const productSlug = `p20-db-${tag}`;
  const mediaKey = `p20-db-${tag}.jpg`;
  let productId = "";
  let mediaId = "";
  let categorySlug = "";

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    service = new PhotographyService(prisma);

    const category = await prisma.category.findFirst({ where: { deletedAt: null }, select: { id: true, slug: true } });
    if (!category) throw new Error("دسته‌ای در DB نیست — seed لازم است.");
    categorySlug = category.slug;

    const product = await prisma.product.create({
      data: {
        name: "محصولِ تستِ برنامهٔ عکاسی",
        slug: productSlug,
        status: "DRAFT",
        categoryId: category.id,
        basePrice: 100_000n,
      },
    });
    productId = product.id;

    const media = await prisma.media.create({
      data: { kind: "image", storageKey: mediaKey, mime: "image/jpeg", sizeBytes: 2048n },
    });
    mediaId = media.id;
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { id: productId } }).catch(() => undefined);
    await prisma.media.deleteMany({ where: { id: mediaId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  /** ردیفِ محصول، دقیقاً مثل selectِ کاتالوگ عمومی */
  const catalogRow = async () => {
    const row = await prisma.product.findFirstOrThrow({
      where: { id: productId },
      select: {
        id: true, slug: true, name: true, shortDescription: true, createdAt: true,
        category: { select: { slug: true } },
        brand: { select: { slug: true } },
        images: {
          orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
          select: { mediaId: true, isPrimary: true, sortOrder: true, alt: true },
        },
        variants: {
          where: { deletedAt: null, status: "PUBLISHED" },
          select: {
            sku: true, price: true, stockQty: true, reservedQty: true,
            terms: {
              select: {
                attributeTermId: true,
                term: {
                  select: {
                    id: true, slug: true, value: true, hex: true, sortOrder: true,
                    attribute: { select: { slug: true, isVariantAxis: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    const mediaMap = new Map<string, string>();
    const medias = await prisma.media.findMany({
      where: { id: { in: row.images.map((i) => i.mediaId) } },
      select: { id: true, storageKey: true },
    });
    for (const m of medias) mediaMap.set(m.id, m.storageKey);
    return {
      ...row,
      images: resolveImages(row.images, mediaMap),
      variants: row.variants.map(flattenVariantTerms),
    };
  };

  it("پیوستِ عکس → ردیفِ PhotoTask در DB ساخته می‌شود (و یکتایی «محصول × کادر» می‌ماند)", async () => {
    const r = await service.attachShot(productId, "FLAT_FRONT", { mediaId, note: "نور خوب" });
    expect(r.status).toBe("SHOT");

    const row = await prisma.photoTask.findUnique({ where: { id: r.taskId } });
    expect(row?.status).toBe("SHOT");
    expect(row?.mediaId).toBe(mediaId);
    expect(row?.note).toBe("نور خوب");

    // پیوستِ دوباره همان کادر، ردیفِ تازه نمی‌سازد (upsert)
    const again = await service.attachShot(productId, "FLAT_FRONT", { mediaId });
    expect(again.taskId).toBe(r.taskId);
    expect(await prisma.photoTask.count({ where: { productId } })).toBe(1);

    // تا وقتی تأیید نشده، فروشگاه هنوز آرت می‌کشد
    const shaped = shapeCommon(await catalogRow(), new Map());
    expect(shaped.image).toBeNull();
  });

  it("فایلِ غیرتصویری پیوست نمی‌شود", async () => {
    const doc = await prisma.media.create({
      data: { kind: "document", storageKey: `p20-doc-${tag}.pdf`, mime: "application/pdf", sizeBytes: 10n },
    });
    try {
      await expect(service.attachShot(productId, "FLAT_BACK", { mediaId: doc.id })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    } finally {
      await prisma.media.deleteMany({ where: { id: doc.id } });
    }
  });

  it("تأییدِ «نمای صافِ جلو» → عکسِ اصلیِ محصول در DB عوض می‌شود و فروشگاه عکسِ واقعی را نشان می‌دهد", async () => {
    const task = await prisma.photoTask.findFirstOrThrow({ where: { productId, shotKind: "FLAT_FRONT" } });
    const r = await service.approveTask(task.id);
    expect(r.status).toBe("APPROVED");
    expect(r.live).toBe(true);

    const images = await prisma.productImage.findMany({ where: { productId } });
    expect(images).toHaveLength(1);
    expect(images[0].isPrimary).toBe(true);
    expect(images[0].mediaId).toBe(mediaId);

    const shaped = shapeCommon(await catalogRow(), new Map());
    expect(shaped.image).toBe(`/api/media/${mediaKey}`);
    expect(shaped.images).toHaveLength(1);
  });

  it("تابلو: محصول در دستهٔ خودش با کادرِ تأییدشده و «زنده» دیده می‌شود", async () => {
    const board = await service.board();
    const group = board.categories.find((c) => c.slug === categorySlug);
    expect(group).toBeDefined();
    const entry = group!.products.find((p) => p.id === productId);
    expect(entry).toBeDefined();
    expect(entry!.done).toBe(1);
    expect(entry!.total).toBe(entry!.shots.length);
    expect(entry!.percent).toBe(Math.round((entry!.done / entry!.total) * 100));
    const front = entry!.shots.find((s) => s.kind === "FLAT_FRONT");
    expect(front?.status).toBe("APPROVED");
    expect(front?.live).toBe(true);
    expect(front?.mediaUrl).toBe(`/api/media/${mediaKey}`);
  });

  it("«عکسِ دوباره» → عکسِ اصلی حذف و فروشگاه به آرت برمی‌گردد", async () => {
    const task = await prisma.photoTask.findFirstOrThrow({ where: { productId, shotKind: "FLAT_FRONT" } });
    const r = await service.retakeTask(task.id, { note: "برچسبِ سایز خوانا نبود" });
    expect(r.status).toBe("NEEDS_RETAKE");

    const row = await prisma.photoTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.mediaId).toBeNull();
    expect(row.note).toBe("برچسبِ سایز خوانا نبود");
    expect(await prisma.productImage.count({ where: { productId } })).toBe(0);

    const shaped = shapeCommon(await catalogRow(), new Map());
    expect(shaped.image).toBeNull();
  });

  it("کادرِ غیراصلی گالری را پر می‌کند ولی عکسِ اصلی نمی‌شود", async () => {
    const r = await service.attachShot(productId, "FLAT_BACK", { mediaId });
    const approved = await service.approveTask(r.taskId);
    expect(approved.live).toBe(false);

    const images = await prisma.productImage.findMany({ where: { productId } });
    expect(images).toHaveLength(1);
    expect(images[0].isPrimary).toBe(false);

    const shaped = shapeCommon(await catalogRow(), new Map());
    expect(shaped.image).toBeNull();
    expect(shaped.images).toHaveLength(1);
  });

  it("تأییدِ گروهی: دو محصول در یک درخواست، هر دو عکسِ اصلی می‌شوند", async () => {
    // محصولِ دومی می‌سازیم تا «چند محصول در یک کلیک» واقعاً همان باشد
    const second = await prisma.product.create({
      data: {
        name: "محصولِ دومِ تستِ تأییدِ گروهی",
        slug: `${productSlug}-b`,
        status: "DRAFT",
        categoryId: (await prisma.category.findFirstOrThrow({ where: { slug: categorySlug } })).id,
        basePrice: 100_000n,
      },
    });

    try {
      const first = await service.attachShot(productId, "FLAT_FRONT", { mediaId });
      const other = await service.attachShot(second.id, "FLAT_FRONT", { mediaId });

      const r = await service.approveMany([first.taskId, other.taskId, "task-does-not-exist"]);
      expect(r.approved).toBe(2);
      expect(r.live).toBe(2);
      expect(r.failed).toHaveLength(1);
      expect(r.failed[0].taskId).toBe("task-does-not-exist");

      const primaries = await prisma.productImage.findMany({
        where: { productId: { in: [productId, second.id] }, isPrimary: true },
        select: { productId: true, mediaId: true },
      });
      expect(primaries).toHaveLength(2);
      expect(primaries.map((p) => p.productId).sort()).toEqual([productId, second.id].sort());
      expect(primaries.every((p) => p.mediaId === mediaId)).toBe(true);
    } finally {
      await prisma.photoTask.deleteMany({ where: { productId: second.id } }).catch(() => undefined);
      await prisma.productImage.deleteMany({ where: { productId: second.id } }).catch(() => undefined);
      await prisma.product.deleteMany({ where: { id: second.id } }).catch(() => undefined);
    }
  });
});
