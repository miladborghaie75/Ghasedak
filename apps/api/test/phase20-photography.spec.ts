/**
 * گام ۲۰ — برنامهٔ عکاسی محصول: چرخهٔ کار و «جایگزینیِ آرت با عکسِ واقعی».
 *
 * چرا بدون DB: این سرویس یک ماشینِ حالت است — «عکس گرفته شد» → «تأیید» →
 * «عکسِ اصلیِ محصول شد» → «عکسِ دوباره» → «برگشت به آرت». اگر این ماشین اشتباه
 * باشد، عکسِ واقعی جلوی چشمِ مشتری نمی‌آید یا آرتِ جانشینِ باطل در سایت می‌ماند.
 * اینجا با یک Prisma ساختگیِ کوچک (همان فراخوانی‌ها، همان شکل پاسخ) تست می‌شود
 * تا منطقِ تصمیم‌ها مستقل از دیتابیس قفل شود. (تست‌های DB-محورِ کاتالوگ در
 * phase14-catalog-public هستند؛ این فایل دروازهٔ منطقِ عکاسی است.)
 *
 * نکتهٔ مهم: «جایگزینیِ آرت» فقط وقتی واقعی است که عکسِ تأییدشده **عکسِ اصلیِ
 * محصول** شود. سرویس این کار را با `ProductImage.isPrimary` می‌کند و
 * `shapeCommon` (کاتالوگ عمومی) از همان برای `image` می‌خواند — پس آخرین
 * حلقهٔ زنجیره همین‌جا تست می‌شود: تا وقتی عکسِ اصلی عوض نشده، فروشگاه
 * `image: null` می‌گیرد و آرت می‌کشد.
 */
import "reflect-metadata";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  PHOTO_BULK_APPROVE_MAX,
  PHOTO_SHOTS,
  PHOTO_STATUS_LABELS,
  PHOTO_TASK_STATUSES,
  PRIMARY_PHOTO_SHOT,
  isPhotoShotKind,
  photoSpecForCategory,
} from "@ghasedak/contracts";
import { PhotographyService } from "../src/photography/photography.service";
import { shapeCommon } from "../src/catalog/public-catalog.controller";
import type { PrismaService } from "../src/prisma/prisma.service";

/* ─────────────────────────── Prisma ساختگی ─────────────────────────── */

type Row = Record<string, unknown>;

/**
 * پیاده‌سازیِ کوچکِ همان فراخوانی‌هایی که PhotographyService می‌زند.
 * عمداً «کوچک» است: هر متدی که سرویس صدا می‌زند اینجا هست و بقیه نیست —
 * اگر سرویس روزی فراخوانیِ تازه‌ای اضافه کرد، تست باید قرمز شود (نه سبزِ کاذب).
 */
class FakePrisma {
  products: Row[] = [];
  medias: Row[] = [];
  tasks: Row[] = [];
  productImages: Row[] = [];
  private seq = 0;
  private nextId(prefix: string): string {
    this.seq += 1;
    return `${prefix}-${this.seq}`;
  }

  readonly product = {
    findMany: async (args: { where?: { deletedAt?: null }; orderBy?: { name?: string } }) => {
      const rows = this.products.filter((p) => (args.where?.deletedAt === null ? p.deletedAt === null : true));
      if (args.orderBy?.name === "asc") rows.sort((a, b) => String(a.name).localeCompare(String(b.name), "fa"));
      return rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        status: r.status,
        category: r.category,
        // رابطه‌هایی که سرویس می‌خواند (select شامل آن‌هاست)
        images: this.productImages
          .filter((i) => i.productId === r.id)
          .map((i) => ({ mediaId: i.mediaId, isPrimary: i.isPrimary, sortOrder: i.sortOrder })),
        photoTasks: this.tasks
          .filter((t) => t.productId === r.id)
          .map((t) => ({ id: t.id, shotKind: t.shotKind, status: t.status, mediaId: t.mediaId, note: t.note })),
      }));
    },
    findFirst: async (args: { where: { id: string; deletedAt?: null } }) => {
      const hit = this.products.find(
        (p) => p.id === args.where.id && (args.where.deletedAt === null ? p.deletedAt === null : true),
      );
      return hit ? { id: hit.id, name: hit.name } : null;
    },
  };

  readonly media = {
    findMany: async (args: { where: { id: { in: string[] } } }) =>
      this.medias.filter((m) => args.where.id.in.includes(String(m.id))).map((m) => ({ ...m })),
    findUnique: async (args: { where: { id: string } }) => {
      const hit = this.medias.find((m) => m.id === args.where.id);
      return hit ? { ...hit } : null;
    },
  };

  readonly photoTask = {
    findUnique: async (args: { where: { id: string } }) => {
      const hit = this.tasks.find((t) => t.id === args.where.id);
      if (!hit) return null;
      const product = this.products.find((p) => p.id === hit.productId);
      return { ...hit, product: product ? { id: product.id, name: product.name } : null };
    },
    upsert: async (args: {
      where: { productId_shotKind: { productId: string; shotKind: string } };
      create: Row;
      update: Row;
    }) => {
      const key = args.where.productId_shotKind;
      const hit = this.tasks.find((t) => t.productId === key.productId && t.shotKind === key.shotKind);
      if (hit) {
        Object.assign(hit, args.update, { updatedAt: new Date() });
        return { id: hit.id, status: hit.status };
      }
      const row: Row = { id: this.nextId("task"), ...args.create };
      this.tasks.push(row);
      return { id: row.id, status: row.status };
    },
    update: async (args: { where: { id: string }; data: Row }) => {
      const hit = this.tasks.find((t) => t.id === args.where.id);
      if (!hit) throw new NotFoundException({ code: "TASK_NOT_FOUND", message: "کارِ عکاسی یافت نشد." });
      Object.assign(hit, args.data, { updatedAt: new Date() });
      return { ...hit };
    },
  };

  readonly productImage = {
    updateMany: async (args: { where: { productId: string; isPrimary?: boolean }; data: Row }) => {
      let count = 0;
      for (const img of this.productImages) {
        if (img.productId !== args.where.productId) continue;
        if (args.where.isPrimary !== undefined && img.isPrimary !== args.where.isPrimary) continue;
        Object.assign(img, args.data);
        count += 1;
      }
      return { count };
    },
    findFirst: async (args: { where: { productId: string; mediaId: string } }) => {
      const hit = this.productImages.find(
        (i) => i.productId === args.where.productId && i.mediaId === args.where.mediaId,
      );
      return hit ? { ...hit } : null;
    },
    update: async (args: { where: { id: string }; data: Row }) => {
      const hit = this.productImages.find((i) => i.id === args.where.id);
      if (!hit) throw new NotFoundException({ code: "NOT_FOUND", message: "تصویر یافت نشد." });
      Object.assign(hit, args.data);
      return { ...hit };
    },
    create: async (args: { data: Row }) => {
      const row = { id: this.nextId("pimg"), ...args.data };
      this.productImages.push(row);
      return { ...row };
    },
    aggregate: async (args: { where: { productId: string }; _max: { sortOrder: true } }) => {
      const rows = this.productImages.filter((i) => i.productId === args.where.productId);
      const max = rows.reduce((m, r) => Math.max(m, Number(r.sortOrder ?? -1)), -1);
      return { _max: { sortOrder: max } };
    },
    deleteMany: async (args: { where: { productId: string; mediaId?: string } }) => {
      const before = this.productImages.length;
      this.productImages = this.productImages.filter(
        (i) => !(i.productId === args.where.productId && (args.where.mediaId === undefined || i.mediaId === args.where.mediaId)),
      );
      return { count: before - this.productImages.length };
    },
  };

  /** تراکنش = همان وضعیت؛ این سرویس نیمه‌سخت (semi-strict) است و به rollback نیاز ندارد */
  $transaction = async <T>(fn: (tx: FakePrisma) => Promise<T>): Promise<T> => fn(this);
}

function seedFake(): { prisma: FakePrisma; service: PhotographyService } {
  const prisma = new FakePrisma();
  prisma.products = [
    {
      id: "p-bra-1",
      slug: "bra-1",
      name: "سوتین نخی",
      status: "PUBLISHED",
      deletedAt: null,
      category: { slug: "bra", name: "سوتین" },
      images: [],
    },
    {
      id: "p-bra-2",
      slug: "bra-2",
      name: "سوتین حریر",
      status: "DRAFT",
      deletedAt: null,
      category: { slug: "bra", name: "سوتین" },
      images: [],
    },
    {
      id: "p-set-1",
      slug: "set-1",
      name: "ست لباس زیر",
      status: "PUBLISHED",
      deletedAt: null,
      category: { slug: "set", name: "ستِ لباس زیر" },
      images: [],
    },
  ];
  prisma.medias = [
    { id: "m-front", storageKey: "p-bra-1-front.jpg", kind: "image", mime: "image/jpeg" },
    { id: "m-back", storageKey: "p-bra-1-back.jpg", kind: "image", mime: "image/jpeg" },
    { id: "m-pdf", storageKey: "spec.pdf", kind: "document", mime: "application/pdf" },
  ];
  const service = new PhotographyService(prisma as unknown as PrismaService);
  return { prisma, service };
}

/* ─────────────────────────── قرارداد ─────────────────────────── */

describe("Phase 20 — قراردادِ برنامهٔ عکاسی", () => {
  it("کادرهای استاندارد همگی تعریف و برچسب فارسی دارند", () => {
    for (const shot of PHOTO_SHOTS) {
      expect(shot.label.length).toBeGreaterThan(0);
      expect(shot.spec.length).toBeGreaterThan(0);
    }
    expect(PHOTO_SHOTS.some((s) => s.kind === PRIMARY_PHOTO_SHOT)).toBe(true);
  });

  it("هر وضعیت، برچسبِ فارسیِ خودش را دارد — پنل و API یک واژگان", () => {
    for (const s of PHOTO_TASK_STATUSES) {
      expect(PHOTO_STATUS_LABELS[s]).toBeTruthy();
    }
  });

  it("دستهٔ ناشناخته هم مشخصات دارد (پیش‌فرضِ امن) — برنامه هیچ‌وقت خالی نمی‌شود", () => {
    const spec = photoSpecForCategory("brand-new-category");
    expect(spec.shots.length).toBeGreaterThan(0);
    expect(spec.shots.some((s) => s.kind === PRIMARY_PHOTO_SHOT && s.required)).toBe(true);
  });

  it("دستهٔ استاندارد، کادرهای اجباریِ خودش را دارد", () => {
    const bra = photoSpecForCategory("bra");
    expect(bra.shots.find((s) => s.kind === PRIMARY_PHOTO_SHOT)?.required).toBe(true);
    // «نمای رنگ‌ها» برای گن اختیاری است — مشخصاتِ هر دسته فرق دارد
    expect(photoSpecForCategory("shapewear").shots.find((s) => s.kind === "COLORS")?.required).toBe(false);
  });

  it("کادرِ ناشناخته شناسایی نمی‌شود", () => {
    expect(isPhotoShotKind("FLAT_FRONT")).toBe(true);
    expect(isPhotoShotKind("FLAT_SIDE")).toBe(false);
    expect(isPhotoShotKind(7)).toBe(false);
  });
});

/* ─────────────────────────── چرخهٔ کار ─────────────────────────── */

describe("Phase 20 — پیوست و تأییدِ عکس", () => {
  it("کادرِ ناشناخته رد می‌شود", async () => {
    const { service } = seedFake();
    await expect(service.attachShot("p-bra-1", "FLAT_SIDE", { mediaId: "m-front" })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("بدون انتخابِ عکس رد می‌شود", async () => {
    const { service } = seedFake();
    await expect(service.attachShot("p-bra-1", "FLAT_FRONT", {})).rejects.toThrow(BadRequestException);
  });

  it("فایلِ غیرتصویری (مثلاً PDF) پیوست نمی‌شود", async () => {
    const { service } = seedFake();
    await expect(service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-pdf" })).rejects.toThrow(
      BadRequestException,
    );
  });

  it("محصولِ ناموجود رد می‌شود", async () => {
    const { service } = seedFake();
    await expect(service.attachShot("nope", "FLAT_FRONT", { mediaId: "m-front" })).rejects.toThrow(
      NotFoundException,
    );
  });

  it("پیوستِ عکس → وضعیتِ «عکس گرفته شد» (هنوز در سایت دیده نمی‌شود)", async () => {
    const { prisma, service } = seedFake();
    const r = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front", note: "نور خوب" });
    expect(r.status).toBe("SHOT");
    const task = prisma.tasks.find((t) => t.id === r.taskId);
    expect(task?.mediaId).toBe("m-front");
    // تا وقتی تأیید نشده، عکسِ اصلیِ محصول عوض نشده — یعنی سایت هنوز آرت دارد
    expect(prisma.productImages).toHaveLength(0);
  });

  it("تأییدِ «نمای صافِ جلو» → همان عکس، عکسِ اصلیِ محصول می‌شود (آرت کنار می‌رود)", async () => {
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    const r = await service.approveTask(taskId);
    expect(r.status).toBe("APPROVED");
    expect(r.live).toBe(true);
    const hero = prisma.productImages.filter((i) => i.productId === "p-bra-1" && i.isPrimary);
    expect(hero).toHaveLength(1);
    expect(hero[0].mediaId).toBe("m-front");
  });

  it("عکسِ اصلیِ قبلی از حالتِ اصلی خارج می‌شود ولی در گالری می‌ماند", async () => {
    const { prisma, service } = seedFake();
    // عکسِ قبلی (مثلاً عکسِ دستیِ ادمین) به‌عنوان عکسِ اصلی
    prisma.productImages.push({ id: "old", productId: "p-bra-1", mediaId: "m-back", isPrimary: true, sortOrder: 0 });
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    await service.approveTask(taskId);
    const old = prisma.productImages.find((i) => i.id === "old");
    expect(old?.isPrimary).toBe(false);
    const hero = prisma.productImages.find((i) => i.isPrimary && i.productId === "p-bra-1");
    expect(hero?.mediaId).toBe("m-front");
  });

  it("تأییدِ کادرِ غیراصلی فقط گالری را پر می‌کند — عکسِ اصلیِ محصول عوض نمی‌شود", async () => {
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_BACK", { mediaId: "m-back" });
    const r = await service.approveTask(taskId);
    expect(r.live).toBe(false);
    const hero = prisma.productImages.filter((i) => i.productId === "p-bra-1" && i.isPrimary);
    expect(hero).toHaveLength(0);
    expect(prisma.productImages).toHaveLength(1);
  });

  it("تأییدِ بدونِ عکسِ پیوست‌شده رد می‌شود", async () => {
    const { prisma, service } = seedFake();
    prisma.tasks.push({ id: "t-empty", productId: "p-bra-1", shotKind: "FLAT_FRONT", status: "PENDING", mediaId: null });
    await expect(service.approveTask("t-empty")).rejects.toThrow(BadRequestException);
  });

  it("«عکسِ دوباره» → عکسِ ردشده حذف و محصول به آرت برمی‌گردد", async () => {
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    await service.approveTask(taskId);
    expect(prisma.productImages).toHaveLength(1);

    const r = await service.retakeTask(taskId, { note: "برچسبِ سایز خوانا نبود" });
    expect(r.status).toBe("NEEDS_RETAKE");
    const task = prisma.tasks.find((t) => t.id === taskId);
    expect(task?.mediaId).toBeNull();
    expect(task?.note).toBe("برچسبِ سایز خوانا نبود");
    // عکسِ اصلیِ محصول حذف شد ⇒ فروشگاه دوباره آرت می‌کشد
    expect(prisma.productImages).toHaveLength(0);
  });
});

/* ─────────────────────── تابلو و پیشرفت ─────────────────────── */

describe("Phase 20 — تابلوی برنامه", () => {
  it("دسته‌ها بر اساس اولویتِ عکاسی چیده می‌شوند و درصدها درست‌اند", async () => {
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    await service.approveTask(taskId);
    const { taskId: t2 } = await service.attachShot("p-bra-1", "FLAT_BACK", { mediaId: "m-back" });

    const board = await service.board();
    const bra = board.categories.find((c) => c.slug === "bra");
    expect(bra).toBeDefined();
    expect(bra!.products).toHaveLength(2);
    const p1 = bra!.products.find((p) => p.id === "p-bra-1")!;
    // «پیشرفت» = عکس گرفته شده (SHOT) یا تأییدشده (APPROVED) — کارِ عکاس وقتی
    // تمام می‌شود که عکس گرفته شده باشد؛ تأیید، دروازهٔ بعدی است نه بخشی از پیشرفت.
    expect(p1.done).toBe(2);
    expect(p1.total).toBe(p1.shots.length);
    expect(p1.percent).toBe(Math.round((p1.done / p1.total) * 100));
    // «زنده» فقط برای همان کادری است که عکسِ اصلیِ محصول است
    expect(p1.shots.find((s) => s.kind === "FLAT_FRONT")?.live).toBe(true);
    expect(p1.shots.find((s) => s.kind === "FLAT_BACK")?.live).toBe(false);
    // ترتیبِ دسته‌ها: اولویتِ قرارداد (bra=1, set=2)
    expect(board.categories.map((c) => c.slug)).toEqual(["bra", "set"]);
    void t2;
  });

  it("محصولِ بدونِ عکسِ اصلی، «آرتِ جانشین» شمرده می‌شود", async () => {
    const { service } = seedFake();
    const board = await service.board();
    expect(board.overall.productsTotal).toBe(3);
    expect(board.overall.productsWithArt).toBe(3);
    expect(board.overall.percent).toBe(0);
  });

  it("عکسِ گالری به‌تنهایی آرت را کنار نمی‌زند — محصول هنوز «آرت» شمرده می‌شود", async () => {
    // قاعدهٔ فروشگاه: فقط تصویرِ primary خوانده می‌شود. پس محصولی که فقط
    // عکسِ گالری دارد هنوز آرت می‌کشد و باید در شمارشِ «آرت» بماند.
    const { prisma, service } = seedFake();
    prisma.productImages.push({ id: "gal", productId: "p-bra-1", mediaId: "m-back", isPrimary: false, sortOrder: 0 });
    const board = await service.board();
    expect(board.overall.productsWithArt).toBe(3);
  });

  it("محصولِ با عکسِ اصلی از شمارشِ «آرت» بیرون می‌آید", async () => {
    const { prisma, service } = seedFake();
    prisma.productImages.push({ id: "hero", productId: "p-bra-1", mediaId: "m-front", isPrimary: true, sortOrder: 0 });
    const board = await service.board();
    expect(board.overall.productsWithArt).toBe(2);
  });

  it("شمارشِ وضعیت‌ها در کلِ برنامه با تابلو می‌خواند", async () => {
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    await service.retakeTask(taskId);
    const board = await service.board();
    const sum = Object.values(board.overall.byStatus).reduce((s, n) => s + n, 0);
    expect(sum).toBe(board.overall.total);
    expect(board.overall.byStatus.NEEDS_RETAKE).toBe(1);
    expect(board.overall.byStatus.APPROVED).toBe(0);
    void prisma;
  });

  it("محصولِ پیش‌نویس هم در تابلو هست — عکاسیِ محصولِ در راه هم لازم است", async () => {
    const { service } = seedFake();
    const board = await service.board();
    const draft = board.categories
      .find((c) => c.slug === "bra")
      ?.products.find((p) => p.id === "p-bra-2");
    expect(draft?.status).toBe("DRAFT");
  });
});

/* ─────────── حلقهٔ آخر: آرتِ فروشگاه ↔ عکسِ اصلیِ محصول ─────────── */

describe("Phase 20 — جایگزینیِ آرت با عکسِ واقعی (زنجیرهٔ فروشگاه)", () => {
  /** همان شکلِ ردیفِ کاتالوگ — فقط تصویرها و بدون واریانت */
  const catalogRow = (prisma: FakePrisma, productId: string) => {
    const p = prisma.products.find((x) => x.id === productId)!;
    const images = prisma.productImages
      .filter((i) => i.productId === productId)
      .map((i) => ({
        mediaId: String(i.mediaId),
        isPrimary: Boolean(i.isPrimary),
        sortOrder: Number(i.sortOrder ?? 0),
        alt: (i.alt as string | null) ?? null,
      }))
      .sort((a, b) => (a.isPrimary === b.isPrimary ? a.sortOrder - b.sortOrder : a.isPrimary ? -1 : 1));
    const mediaMap = new Map(prisma.medias.map((m) => [String(m.id), String(m.storageKey)]));
    return {
      id: String(p.id),
      slug: String(p.slug),
      name: String(p.name),
      shortDescription: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      category: { slug: "bra" },
      brand: null,
      images: images
        .map((i) => ({ ...i, storageKey: mediaMap.get(i.mediaId) ?? "" }))
        .filter((i) => i.storageKey !== ""),
      variants: [],
    };
  };

  it("پیش از تأییدِ عکس — فروشگاه آرت می‌کشد (image خالی است)", async () => {
    const { prisma, service } = seedFake();
    await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    const shaped = shapeCommon(catalogRow(prisma, "p-bra-1"), new Map());
    expect(shaped.image).toBeNull();
  });

  it("پس از تأییدِ «نمای صافِ جلو» — فروشگاه عکسِ واقعی را نشان می‌دهد", async () => {
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    await service.approveTask(taskId);
    const shaped = shapeCommon(catalogRow(prisma, "p-bra-1"), new Map());
    expect(shaped.image).toBe("/api/media/p-bra-1-front.jpg");
  });

  it("پس از «عکسِ دوباره» — فروشگاه دوباره به آرت برمی‌گردد", async () => {
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    await service.approveTask(taskId);
    await service.retakeTask(taskId);
    const shaped = shapeCommon(catalogRow(prisma, "p-bra-1"), new Map());
    expect(shaped.image).toBeNull();
  });

  it("کادرِ غیراصلی هرگز عکسِ اصلیِ محصول را عوض نمی‌کند", async () => {
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_BACK", { mediaId: "m-back" });
    await service.approveTask(taskId);
    const shaped = shapeCommon(catalogRow(prisma, "p-bra-1"), new Map());
    expect(shaped.image).toBeNull();
  });

  it("عکسِ گالری حتی تنها تصویرِ محصول هم عکسِ اصلی نمی‌شود — آرت می‌ماند", async () => {
    // قاعده: «عکسِ اصلی» فقط از تصویرِ primary خوانده می‌شود. اگر این قاعده
    // نبود، تأییدِ یک عکسِ جزئی (مثلاً پارچه) ناخواسته عکسِ اصلیِ کارت را می‌گرفت.
    const { prisma, service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FABRIC", { mediaId: "m-back" });
    await service.approveTask(taskId);
    expect(prisma.productImages).toHaveLength(1);
    expect(prisma.productImages[0].isPrimary).toBe(false);
    const shaped = shapeCommon(catalogRow(prisma, "p-bra-1"), new Map());
    expect(shaped.image).toBeNull();
    // ولی در گالریِ محصول هست — داده گم نمی‌شود
    expect(shaped.images).toHaveLength(1);
  });
});

/* ─────────────────────────── تأییدِ گروهی ─────────────────────────── */

describe("Phase 20 — تأییدِ گروهی (چند محصول در یک کلیک)", () => {
  it("دو کادر از دو محصول با یک درخواست تأیید می‌شوند و هر دو گزارش می‌شوند", async () => {
    const { prisma, service } = seedFake();
    const front = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    const setFront = await service.attachShot("p-set-1", "FLAT_FRONT", { mediaId: "m-front" });

    const r = await service.approveMany([front.taskId, setFront.taskId]);
    expect(r.approved).toBe(2);
    // هر دو «نمای صافِ جلو» بودند → هر دو عکسِ اصلی شدند
    expect(r.live).toBe(2);
    expect(r.failed).toEqual([]);

    const imgs = prisma.productImages.filter((i) => i.isPrimary);
    expect(imgs.map((i) => i.productId).sort()).toEqual(["p-bra-1", "p-set-1"]);
  });

  it("شناسهٔ تکراری دوبار تأیید نمی‌شود (همان کار، یک نتیجه)", async () => {
    const { service } = seedFake();
    const { taskId } = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });
    const r = await service.approveMany([taskId, ` ${taskId} `, taskId]);
    expect(r.approved).toBe(1);
  });

  it("یک شناسهٔ کهنه بقیهٔ کارهای سالم را برنمی‌گرداند — دلیلِ شکست هم می‌آید", async () => {
    const { prisma, service } = seedFake();
    const ok = await service.attachShot("p-bra-1", "FLAT_BACK", { mediaId: "m-back" });

    const r = await service.approveMany(["task-ghost", ok.taskId]);
    expect(r.approved).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].taskId).toBe("task-ghost");
    // پیامِ فارسیِ سرویس، نه متنِ خامِ Prisma
    expect(r.failed[0].message).toMatch(/یافت نشد/);
    expect(prisma.productImages).toHaveLength(1);
  });

  it("کادرِ بدونِ عکس، شکستِ خودش را می‌دهد و بقیه تأیید می‌شوند", async () => {
    const { prisma, service } = seedFake();
    // یک کار که عکسش برداشته شده است (مثلِ «عکسِ دوباره» هم‌زمان)
    prisma.tasks.push({ id: "t-empty", productId: "p-bra-1", shotKind: "FLAT_BACK", status: "NEEDS_RETAKE", mediaId: null });
    const front = await service.attachShot("p-bra-1", "FLAT_FRONT", { mediaId: "m-front" });

    const r = await service.approveMany(["t-empty", front.taskId]);
    expect(r.approved).toBe(1);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].message).toMatch(/عکسی ثبت نشده/);
  });

  it("فهرستِ خالی رد می‌شود و بیش از سقف هم خطای روشن می‌دهد", async () => {
    const { service } = seedFake();
    await expect(service.approveMany([])).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.approveMany(undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.approveMany(["", "  "])).rejects.toBeInstanceOf(BadRequestException);

    const tooMany = Array.from({ length: PHOTO_BULK_APPROVE_MAX + 1 }, (_, i) => `t-${i}`);
    await expect(service.approveMany(tooMany)).rejects.toBeInstanceOf(BadRequestException);
  });
});
