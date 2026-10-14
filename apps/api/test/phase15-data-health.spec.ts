/**
 * گام F0-3 — گارد متن خراب + جاب سلامت داده.
 *
 * سه چیز سنجیده می‌شود:
 *  ۱) ورودی خراب (U+FFFD/کنترلی) در همان لحظهٔ نوشتن *رد* می‌شود — هم در
 *     ساخت محصول و هم در ویرایش کامل.
 *  ۲) ردیف خرابِ از قبل موجود با اسکن پیدا می‌شود و اصلاحش صادقانه است:
 *     نام از شواهد SKU، اسلاگ بازساخته، ردیف آرشیو، توضیح خراب پاک.
 *  ۳) اجرای دوبارهٔ اصلاح هیچ تغییری نمی‌دهد (idempotent) و هر ردیف
 *     AuditLog با قبل/بعد دارد.
 *
 * روی rehearsal اجرا می‌شود؛ ردیف‌های خودش را می‌سازد و در پایان پاک می‌کند.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { standaloneProductsService } from "../src/products/products.service";
import { DataHealthService, isInvalidSlug } from "../src/admin/data-health.service";
import { findDirtyText, REPLACEMENT_CHAR } from "../src/common/text-guard";

jest.setTimeout(120_000);

const FFFD = REPLACEMENT_CHAR;

describe("Phase 15 — گارد متن خراب و جاب سلامت داده", () => {
  let prisma: PrismaService;
  let health: DataHealthService;
  const tag = `${Date.now().toString(36)}`;
  const createdProducts: string[] = [];
  let categoryId = "";
  let dirtyCategoryId = "";
  let dirtyProductId = "";
  let cleanProductId = "";

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    health = new DataHealthService(prisma);

    const cat = await prisma.category.create({
      data: { name: `تست کیفیت داده ${tag}`, slug: `tdh-${tag}` },
    });
    categoryId = cat.id;
  });

  afterAll(async () => {
    const ids = [...createdProducts];
    if (dirtyProductId) ids.push(dirtyProductId);
    if (cleanProductId) ids.push(cleanProductId);
    await prisma.auditLog.deleteMany({ where: { action: "data.health.repair", entityId: { in: ids } } }).catch(() => undefined);
    await prisma.product.deleteMany({ where: { id: { in: ids } } }).catch(() => undefined);
    if (dirtyCategoryId) await prisma.category.delete({ where: { id: dirtyCategoryId } }).catch(() => undefined);
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  describe("۱) طبقه‌بند متن (همان تابعی که گارد نوشتن استفاده می‌کند)", () => {
    it("کاراکتر جانشین U+FFFD را خراب می‌داند", () => {
      expect(findDirtyText(`سوتین ${FFFD}`)).toBe("REPLACEMENT_CHAR");
      expect(findDirtyText(`${FFFD}${FFFD}${FFFD}`)).toBe("REPLACEMENT_CHAR");
    });

    it("کاراکتر کنترلی را خراب می‌داند ولی خط جدید/تب را نه", () => {
      expect(findDirtyText("سوتین\u0007کشباف")).toBe("CONTROL_CHAR");
      expect(findDirtyText("سوتین\u0085کشباف")).toBe("CONTROL_CHAR");
      expect(findDirtyText("خط اول\nخط دوم\tستون")).toBeNull();
    });

    it("متن سالم فارسی (با نیم‌فاصله و ی/ک عربی) را سالم می‌داند", () => {
      expect(findDirtyText("سوتین کش‌باف مدل «آرام» — سایز ۷۵B")).toBeNull();
      expect(findDirtyText("سوتين کاپ‌دار")).toBeNull();
      expect(findDirtyText(null)).toBeNull();
      expect(findDirtyText("")).toBeNull();
    });

    it("اسلاگ نامعتبر شناسایی می‌شود (دقیقاً همان `-` و `--muena3ig` بازرسی)", () => {
      expect(isInvalidSlug("-")).toBe(true);
      expect(isInvalidSlug("--muena3ig")).toBe(true);
      expect(isInvalidSlug("")).toBe(true);
      expect(isInvalidSlug("سوتین-کشباف")).toBe(false);
      expect(isInvalidSlug("recovered-star-bra-blk-m")).toBe(false);
    });
  });

  describe("۲) گارد نوشتن — ورودی خراب همان لحظه رد می‌شود", () => {
    it("ساخت محصول با نام خراب → INVALID_TEXT با fieldError نام", async () => {
      const svc = standaloneProductsService(prisma);
      const before = await prisma.product.count({ where: { name: { contains: FFFD } } });
      await expect(
        svc.createFull({
          name: `${FFFD}${FFFD}${FFFD}${FFFD}`,
          categoryId,
          basePrice: 500_000,
        }),
      ).rejects.toMatchObject({
        response: { code: "INVALID_TEXT", fieldErrors: { name: expect.arrayContaining([expect.stringContaining("U+FFFD")]) } },
      });
      // هیچ ردیف تازهٔ خرابی ساخته نشده است
      expect(await prisma.product.count({ where: { name: { contains: FFFD } } })).toBe(before);
    });

    it("ساخت محصول با توضیح خراب → رد؛ متن سالم (نیم‌فاصله/چندخطی) → قبول", async () => {
      const svc = standaloneProductsService(prisma);
      await expect(
        svc.createFull({
          name: `محصول سالم ${tag}`,
          categoryId,
          basePrice: 500_000,
          description: `توضیح ${FFFD} خراب`,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      const ok = (await svc.createFull({
        name: `محصول سالم ${tag}`,
        categoryId,
        basePrice: 500_000,
        shortDescription: "کش‌باف نرم",
        description: "خط اول\nخط دوم",
      })) as { id: string };
      cleanProductId = ok.id;
      createdProducts.push(ok.id);
      expect(cleanProductId).toBeTruthy();
    });

    it("ویرایش کامل با نام خراب → رد و مقدار قبلی دست‌نخورده", async () => {
      const svc = standaloneProductsService(prisma);
      await expect(
        svc.updateFull(cleanProductId, { name: `محصول ${FFFD}` }),
      ).rejects.toMatchObject({ response: { code: "INVALID_TEXT" } });
      const after = await prisma.product.findUniqueOrThrow({ where: { id: cleanProductId } });
      expect(after.name).toContain("محصول سالم");
    });
  });

  describe("۳) جاب سلامت داده — اسکن، اصلاح صادقانه، idempotent", () => {
    beforeAll(async () => {
      // ردیف خرابِ «از قبل موجود» — شبیه‌سازی همان ورود با انکودینگ اشتباه
      // (از مسیر سرویس دیگر ممکن نیست، چون گارد بالا جلویش را می‌گیرد).
      const dirty = await prisma.product.create({
        data: {
          name: `${FFFD}${FFFD}${FFFD}${FFFD}${FFFD}${FFFD}`,
          // اسلاگ نامعتبر (با خط تیره شروع می‌شود) و یکتا — عمداً شبیه همان
          // ردیف بازرسی، بدون درگیر شدن با slug یکتای ردیف واقعی `-`
          slug: `-${tag}`,
          status: "PUBLISHED",
          categoryId,
          basePrice: 850_000n,
          shortDescription: `${FFFD}${FFFD}`,
          description: `متن ${FFFD} خراب`,
          variants: { create: { sku: `TST-DH-${tag}`, price: 850_000n, stockQty: 0 } },
        },
      });
      dirtyProductId = dirty.id;

      const dirtyCat = await prisma.category.create({
        data: { name: `دستهٔ ${FFFD} خراب`, slug: `tdh-dirty-${tag}` },
      });
      dirtyCategoryId = dirtyCat.id;
    });

    it("اسکن ردیف‌های خراب را با دلیل و فیلد درست پیدا می‌کند", async () => {
      const report = await health.scan();
      const mine = report.findings.filter((f) => f.id === dirtyProductId);
      expect(mine.map((f) => `${f.field}:${f.reason}`).sort()).toEqual(
        ["description:REPLACEMENT_CHAR", "name:REPLACEMENT_CHAR", "shortDescription:REPLACEMENT_CHAR", "slug:INVALID_SLUG"].sort(),
      );
      expect(mine.every((f) => f.repairable)).toBe(true);
      // مقدار خراب برای اپراتور خوانا می‌شود (□ جای U+FFFD)
      expect(mine.find((f) => f.field === "name")!.value).toContain("□");

      // دستهٔ خراب فقط گزارش می‌شود (متن جانشین ندارد → تصمیم اپراتور)
      const catFindings = report.findings.filter((f) => f.id === dirtyCategoryId);
      expect(catFindings.length).toBeGreaterThan(0);
      expect(catFindings.every((f) => f.repairable === false)).toBe(true);
    });

    it("اصلاح: نام از شواهد SKU، اسلاگ بازساخته، آرشیو، توضیح خراب پاک + AuditLog", async () => {
      const res = await health.repair(undefined, [dirtyProductId]);
      const outcome = res.outcomes.find((o) => o.id === dirtyProductId);
      expect(outcome?.action).toBe("REPAIRED");
      expect(outcome?.nameAfter).toContain(`SKU: TST-DH-${tag}`);
      expect(outcome?.slugAfter).toMatch(/^recovered-tst-dh-/);
      expect(outcome?.statusAfter).toBe("ARCHIVED");
      expect(outcome?.clearedFields).toEqual(expect.arrayContaining(["shortDescription", "description"]));

      const row = await prisma.product.findUniqueOrThrow({ where: { id: dirtyProductId } });
      expect(row.name).toBe(outcome!.nameAfter);
      expect(row.slug).toBe(outcome!.slugAfter);
      expect(row.status).toBe("ARCHIVED");
      expect(row.shortDescription).toBeNull();
      expect(row.description).toBeNull();
      // نام/توضیح بازیابی‌شدنی نبودند — پس چیزی «حدس» زده نشده است
      expect(findDirtyText(row.name)).toBeNull();

      const audits = await prisma.auditLog.findMany({ where: { action: "data.health.repair", entityId: dirtyProductId } });
      expect(audits.length).toBe(1);
      expect(audits[0].oldValues).toMatchObject({ slug: `-${tag}`, status: "PUBLISHED" });
      expect(audits[0].newValues).toMatchObject({ status: "ARCHIVED", name: outcome!.nameAfter });
    });

    it("دستهٔ خراب دست‌نخورده می‌ماند (اصلاح خودکار فقط محصول)", async () => {
      await health.repair(undefined, [dirtyCategoryId]);
      const cat = await prisma.category.findUniqueOrThrow({ where: { id: dirtyCategoryId } });
      expect(cat.name).toContain(FFFD);
    });

    it("اجرای دوباره هیچ تغییری نمی‌دهد (idempotent) و اسکن پاک است", async () => {
      const before = await prisma.product.findUniqueOrThrow({ where: { id: dirtyProductId } });
      const res = await health.repair(undefined, [dirtyProductId]);
      expect(res.repaired).toBe(0);
      expect(res.outcomes.some((o) => o.id === dirtyProductId && o.action === "REPAIRED")).toBe(false);
      const after = await prisma.product.findUniqueOrThrow({ where: { id: dirtyProductId } });
      expect({ name: after.name, slug: after.slug, status: after.status }).toEqual({
        name: before.name,
        slug: before.slug,
        status: before.status,
      });
      expect(await prisma.auditLog.count({ where: { action: "data.health.repair", entityId: dirtyProductId } })).toBe(1);

      const report = await health.scan();
      expect(report.findings.filter((f) => f.id === dirtyProductId)).toHaveLength(0);
    });

    it("ردیف سالم پس از اصلاح‌های دیگران دست‌نخورده می‌ماند", async () => {
      const clean = await prisma.product.findUniqueOrThrow({ where: { id: cleanProductId } });
      expect(clean.name).toContain("محصول سالم");
      expect(clean.slug).toContain("محصول-سالم");
    });
  });
});
