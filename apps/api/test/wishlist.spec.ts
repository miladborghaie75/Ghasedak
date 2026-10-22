/**
 * گام ۱۱ (بند ۴۲) — علاقه‌مندی مهمان روی rehearsal DB:
 *  add → idempotent (upsert) → isolate per token → remove → حذف نرم/غیرمنتشر رد می‌شود.
 * همان الگوی cart: توکن کوکی مالکیت را تعیین می‌کند؛ بدون PII.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { WishlistService } from "../src/wishlist/wishlist.service";

jest.setTimeout(60_000);

const MARK = Date.now().toString(36);

describe("Phase 11 — wishlist module (guest, token-scoped)", () => {
  let prisma: PrismaService;
  let svc: WishlistService;
  let productId: string;
  let draftId: string;
  let deletedId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new WishlistService(prisma);

    const cat = await prisma.category.create({
      data: { name: `تست-علاقه-${MARK}`, slug: `test-wishlist-cat-${MARK}` },
    });
    const product = await prisma.product.create({
      data: {
        name: `محصول تست علاقه ${MARK}`,
        slug: `test-wishlist-${MARK}`,
        status: "PUBLISHED",
        categoryId: cat.id,
        basePrice: 100_000n,
      },
    });
    productId = product.id;

    const draft = await prisma.product.create({
      data: {
        name: `پیش‌نویس تست علاقه ${MARK}`,
        slug: `test-wishlist-draft-${MARK}`,
        status: "DRAFT",
        categoryId: cat.id,
        basePrice: 100_000n,
      },
    });
    draftId = draft.id;

    const deleted = await prisma.product.create({
      data: {
        name: `حذف‌شده تست علاقه ${MARK}`,
        slug: `test-wishlist-deleted-${MARK}`,
        status: "PUBLISHED",
        categoryId: cat.id,
        basePrice: 100_000n,
        deletedAt: new Date(),
      },
    });
    deletedId = deleted.id;
  });

  afterAll(async () => {
    // دادهٔ تست با نشانهٔ MARK پاک می‌شود — هرگز دستهٔ واقعی را لمس نمی‌کند.
    // نکته: پاک‌سازی محصول باید بر مبنای categoryId باشد، نه slug contains —
    // slugهای draft/deleted میان «wishlist» و MARK رشته دارند و contains
    // مرکزی آن‌ها را نمی‌گیرد و FK دسته را شکسته بود.
    await prisma.wishlistItem.deleteMany({ where: { ownerKey: { startsWith: `wl-test-${MARK}` } } });
    const cat = await prisma.category.findUnique({ where: { slug: `test-wishlist-cat-${MARK}` } });
    if (cat) {
      await prisma.product.deleteMany({ where: { categoryId: cat.id } });
      await prisma.category.delete({ where: { id: cat.id } });
    }
    await prisma.$disconnect();
  });

  it("بدون توکن: لیست خالی است و افزودن خطای صریح می‌دهد", async () => {
    expect(await svc.list("")).toEqual({ productIds: [] });
    await expect(svc.add("", productId)).rejects.toThrow(BadRequestException);
  });

  it("افزودن → لیست برمی‌گردد؛ add دوباره idempotent است (بدون تکرار)", async () => {
    const token = `wl-test-${MARK}-a`;
    const v1 = await svc.add(token, productId);
    expect(v1.productIds).toEqual([productId]);
    const v2 = await svc.add(token, productId);
    expect(v2.productIds).toEqual([productId]);
    const rows = await prisma.wishlistItem.count({ where: { ownerKey: token, productId } });
    expect(rows).toBe(1); // upsert — نه دو ردیف
  });

  it("ایزوله‌سازی: توکن دیگر آیتم توکن اول را نمی‌بیند", async () => {
    const other = `wl-test-${MARK}-b`;
    const v = await svc.list(other);
    expect(v.productIds).toEqual([]);
    // و افزودن همان محصول برای توکن دیگر سالم است
    const added = await svc.add(other, productId);
    expect(added.productIds).toEqual([productId]);
    const first = await svc.list(`wl-test-${MARK}-a`);
    expect(first.productIds).toEqual([productId]); // دست‌نخورده
  });

  it("محصول غیرمنتشر/حذف‌شده پذیرفته نمی‌شود", async () => {
    const token = `wl-test-${MARK}-c`;
    await expect(svc.add(token, draftId)).rejects.toThrow(BadRequestException);
    await expect(svc.add(token, deletedId)).rejects.toThrow(BadRequestException);
    await expect(svc.add(token, `no-such-${MARK}`)).rejects.toThrow(BadRequestException);
    expect((await svc.list(token)).productIds).toEqual([]);
  });

  it("حذف: فقط آیتم همان توکن را برمی‌دارد؛ لیست توکن دیگر سالم می‌ماند", async () => {
    const a = `wl-test-${MARK}-a`;
    const b = `wl-test-${MARK}-b`;
    const afterRemove = await svc.remove(a, productId);
    expect(afterRemove.productIds).toEqual([]);
    // remove دوباره (idempotent) خطا نمی‌دهد
    expect(await svc.remove(a, productId)).toEqual({ productIds: [] });
    expect((await svc.list(b)).productIds).toEqual([productId]);
    // پاک‌سازی توکن b برای afterAll سبک شود
    await svc.remove(b, productId);
  });
});
