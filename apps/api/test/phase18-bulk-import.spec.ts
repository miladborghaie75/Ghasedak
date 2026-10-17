/**
 * گام ۱۳ (`[F1-3]`) — ورود گروهی محصولات روی rehearsal DB:
 *  پارسر خالص → پیش‌نمایش بدون نوشتن → اعمال تراکنشی (موجودی از مسیر انبار + سند)
 *  → بازگردانی پاک و idempotent → رد پیش‌نمایش کهنه → گارد متن خراب → مجوزها.
 *
 * همهٔ ردیف‌ها با نشانهٔ MARK ساخته می‌شوند و در afterAll پاک می‌شوند.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { JournalService } from "../src/accounting/journal.service";
import { ImportService } from "../src/import/import.service";
import { ImportController } from "../src/import/import.controller";
import { ForbiddenException } from "@nestjs/common";
import { PERMISSION_KEY, PermissionsGuard } from "../src/auth/permissions.guard";
import { COLUMN_LABELS, COLUMNS, mapHeader, normalizeKey, parseCsv, parseMoneyCell, parseStatusCell } from "../src/import/csv-parse";

jest.setTimeout(180_000);

const MARK = `${Date.now().toString(36)}`;
const catSlug = `imp-cat-${MARK}`;
const brandSlug = `imp-brand-${MARK}`;
const sku = {
  create: `IMP-${MARK}-A`,
  update: `IMP-${MARK}-U`,
  skip: `IMP-${MARK}-S`,
  stale: `IMP-${MARK}-T`,
  latest: `IMP-${MARK}-L`,
};
const allSkus = Object.values(sku);

const HEADER = COLUMNS.map((c) => COLUMN_LABELS[c]);

/** ساخت CSV با نقل‌قول RFC4180 — همان قالبی که اپراتور از Excel می‌گیرد */
function csv(rows: string[][]): string {
  const esc = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return [HEADER, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
}

/** ردیف کامل: sku,name,slug,category,brand,status,price,sale,cost,stock,barcode */
function row(v: {
  sku: string;
  name?: string;
  slug?: string;
  category?: string;
  brand?: string;
  status?: string;
  price?: string;
  sale?: string;
  cost?: string;
  stock?: string;
  barcode?: string;
}): string[] {
  return [
    v.sku,
    v.name ?? "",
    v.slug ?? "",
    v.category ?? "",
    v.brand ?? "",
    v.status ?? "",
    v.price ?? "",
    v.sale ?? "",
    v.cost ?? "",
    v.stock ?? "",
    v.barcode ?? "",
  ];
}

describe("Phase 18 — bulk import (F1-3)", () => {
  let prisma: PrismaService;
  let svc: ImportService;
  let categoryId: string;
  let brandId: string;
  let batchIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new ImportService(
      prisma,
      new InventoryService(prisma, new InventorySettingsService(prisma)),
      new JournalService(prisma),
    );

    const cat = await prisma.category.create({
      data: { name: `دستهٔ تست ورود ${MARK}`, slug: catSlug, status: "PUBLISHED" },
    });
    categoryId = cat.id;
    const brand = await prisma.brand.create({
      data: { name: `برند تست ورود ${MARK}`, slug: brandSlug },
    });
    brandId = brand.id;

    for (const [i, s] of [sku.update, sku.skip, sku.stale, sku.latest].entries()) {
      await prisma.product.create({
        data: {
          name: `محصول موجود ${i} ${MARK}`,
          slug: `imp-${MARK}-exist-${i}`,
          status: "DRAFT",
          categoryId,
          basePrice: 100_000n,
          variants: { create: { sku: s, price: 100_000n, stockQty: 0, status: "DRAFT" } },
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entity: "ImportBatch", entityId: { in: batchIds } } }).catch(() => undefined);
    await prisma.importBatch.deleteMany({ where: { id: { in: batchIds } } }).catch(() => undefined);
    await prisma.stockLedgerEntry.deleteMany({ where: { variantSku: { in: allSkus } } }).catch(() => undefined);
    await prisma.priceHistory.deleteMany({ where: { variantSku: { in: allSkus } } }).catch(() => undefined);
    await prisma.stockAlert.deleteMany({ where: { variantSku: { in: allSkus } } }).catch(() => undefined);
    await prisma.product.deleteMany({ where: { variants: { some: { sku: { in: allSkus } } } } }).catch(() => undefined);
    await prisma.category.delete({ where: { id: categoryId } }).catch(() => undefined);
    await prisma.brand.delete({ where: { id: brandId } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("پارسر خالص: BOM، کاما داخل نقل‌قول، CRLF، رقم فارسی/هزارگان، سطر ناقص", () => {
    const parsed = parseCsv('\uFEFFSKU,نام محصول,قیمت\r\nA-1,"بلوز, ساده",۲۵۰٬۰۰۰\r\nA-2,کوتاه\r\n');
    expect(parsed.header[0]).toBe("SKU"); // BOM حذف شد
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0].cells).toEqual(["A-1", "بلوز, ساده", "۲۵۰٬۰۰۰"]);
    expect(parsed.rows[0].rowNo).toBe(2);
    // سطر ناقص با سلول‌های خالی پر می‌شود، جابه‌جایی ستون رخ نمی‌دهد
    expect(parsed.rows[1].cells).toEqual(["A-2", "کوتاه"]);

    expect(parseMoneyCell("۲۵۰٬۰۰۰")).toBe(250_000);
    expect(parseMoneyCell("250,000 تومان")).toBe(250_000);
    expect(parseMoneyCell("۱۲۳۴")).toBe(1234);
    expect(Number.isNaN(parseMoneyCell("دوازده"))).toBe(true);
    expect(parseStatusCell("منتشرشده")).toBe("PUBLISHED");
    expect(parseStatusCell("پیش‌نویس")).toBe("DRAFT");
    expect(parseStatusCell("چیز-عجیب")).toBe("INVALID");

    // هدرهای فارسی و انگلیسی هر دو شناخته می‌شوند
    const map = mapHeader(["SKU", "نام", "قیمت", "ستون ناشناس"]);
    expect(map.index.sku).toBe(0);
    expect(map.index.name).toBe(1);
    expect(map.index.price).toBe(2);
    expect(map.unknown).toEqual(["ستون ناشناس"]);

    // فایل خالی خطای دقیق می‌دهد
    expect(() => parseCsv("   ")).toThrow(/خالی/);
  });

  it("پیش‌نمایش: CREATE/UPDATE/SKIP/ERROR با دلیل — DB محصولات تغییر نمی‌کند", async () => {
    const beforeCount = await prisma.product.count();
    const text = csv([
      row({
        sku: sku.create,
        name: `بلوز, تست ${MARK}`,
        slug: `imp-${MARK}-a`,
        category: `دستهٔ تست ورود ${MARK}`,
        brand: `برند تست ورود ${MARK}`,
        status: "منتشرشده",
        price: "۲۵۰٬۰۰۰",
        sale: "200000",
        cost: "100,000",
        stock: "۵",
      }),
      row({ sku: sku.update, name: `نام تازه ${MARK}` }),
      row({ sku: sku.skip }),
      row({
        sku: `IMP-${MARK}-BAD`,
        name: "محصول دسته ناموجود",
        // یک حرف اضافه — همان غلط تایپی واقعی که باید «نزدیک‌ترین نام» را پیشنهاد بدهد
        category: `دستهٔ تست ورود ${MARK}ی`,
        price: "1000",
      }),
      // تکرار SKU همان ردیف اول — باید خطا بدهد، نه دوبار ایجاد
      row({
        sku: sku.create,
        name: "تکرار",
        category: `دستهٔ تست ورود ${MARK}`,
        price: "1",
      }),
    ]);

    const preview = await svc.preview({ filename: "dirty.csv", text });
    batchIds.push(preview.batchId);
    expect(preview.counts).toEqual({ rowCount: 5, CREATE: 1, UPDATE: 1, SKIP: 1, ERROR: 2 });

    const create = preview.rows.find((r) => r.sku === sku.create && r.rowNo === 2)!;
    expect(create.action).toBe("CREATE");
    expect(create.message).toBeNull(); // بهای خرید دارد → هشدار سند ندارد

    const update = preview.rows.find((r) => r.rowNo === 3)!;
    expect(update.action).toBe("UPDATE");
    expect(update.changes.map((c) => c.path)).toEqual(["product.name"]);
    expect(update.changes[0].after).toBe(`نام تازه ${MARK}`);

    expect(preview.rows.find((r) => r.rowNo === 4)!.action).toBe("SKIP");

    const badCategory = preview.rows.find((r) => r.rowNo === 5)!;
    expect(badCategory.action).toBe("ERROR");
    expect(badCategory.message).toContain("یافت نشد");
    expect(badCategory.message).toContain("نزدیک‌ترین");

    const dup = preview.rows.find((r) => r.rowNo === 6)!;
    expect(dup.action).toBe("ERROR");
    expect(dup.message).toContain("سطر 2");

    // هیچ محصولی نوشته نشده — نه ردیف CREATE و نه UPDATE
    expect(await prisma.product.count()).toBe(beforeCount);
    expect(await prisma.productVariant.findUnique({ where: { sku: sku.create } })).toBeNull();
    const updated = await prisma.productVariant.findUniqueOrThrow({ where: { sku: sku.update }, include: { product: true } });
    expect(updated.product.name).not.toBe(`نام تازه ${MARK}`);

    // اعمال با ردیف خطا ممنوع — پیام شمارهٔ سطر می‌دهد
    await expect(svc.apply(preview.batchId)).rejects.toMatchObject({ response: { code: "PREVIEW_HAS_ERRORS" } });
  });

  it("گارد متن خراب: U+FFFD در نام → ردیف ERROR با پیام روشن", async () => {
    const text = csv([
      row({
        sku: `IMP-${MARK}-DIRTY`,
        name: "بلوز خراب \uFFFD",
        category: `دستهٔ تست ورود ${MARK}`,
        price: "1000",
      }),
    ]);
    const preview = await svc.preview({ filename: "dirty-text.csv", text });
    batchIds.push(preview.batchId);
    expect(preview.counts.ERROR).toBe(1);
    expect(preview.rows[0].message).toContain("U+FFFD");
  });

  it("اعمال: شمارش‌ها = پیش‌نمایش؛ موجودی از مسیر انبار + سند موجودی آغازین", async () => {
    const text = csv([
      row({
        sku: sku.create,
        name: `بلوز, تست ${MARK}`,
        slug: `imp-${MARK}-a`,
        category: `دستهٔ تست ورود ${MARK}`,
        brand: `برند تست ورود ${MARK}`,
        status: "منتشرشده",
        price: "۲۵۰٬۰۰۰",
        sale: "200000",
        cost: "100000",
        stock: "۵",
      }),
      row({ sku: sku.update, name: `نام تازه ${MARK}` }),
    ]);
    const preview = await svc.preview({ filename: "clean.csv", text });
    batchIds.push(preview.batchId);
    expect(preview.counts).toEqual({ rowCount: 2, CREATE: 1, UPDATE: 1, SKIP: 0, ERROR: 0 });

    const before = await prisma.product.count();
    const applied = await svc.apply(preview.batchId);
    expect(applied.alreadyApplied).toBe(false);
    expect(applied.counts).toMatchObject({ CREATE: 1, UPDATE: 1, SKIP: 0, ERROR: 0 });
    expect(await prisma.product.count()).toBe(before + 1);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: sku.create },
      include: { product: true },
    });
    expect(variant.product.name).toBe(`بلوز, تست ${MARK}`);
    expect(variant.product.status).toBe("PUBLISHED");
    expect(variant.product.publishedAt).not.toBeNull();
    expect(variant.price).toBe(250_000n);
    expect(variant.salePrice).toBe(200_000n);
    expect(variant.stockQty).toBe(5);
    expect(variant.barcode).toMatch(/^690\d{10}$/); // بارکد خودکار EAN-13

    // دفتر انبار: یک OPENING با تراز ۵ — نه نوشتن مستقیم روی stockQty
    const ledger = await prisma.stockLedgerEntry.findMany({ where: { variantSku: sku.create } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].type).toBe("OPENING");
    expect(ledger[0].qtyIn).toBe(5);
    expect(ledger[0].balanceAfter).toBe(5);

    // سند موجودی آغازین از همان مسیر ژورنال
    const entry = await prisma.journalEntry.findFirst({
      where: { sourceType: "opening_inventory", sourceId: `${preview.batchId}:${sku.create}` },
      include: { lines: true },
    });
    expect(entry).toBeTruthy();
    expect(entry!.lines).toHaveLength(2);

    // UPDATE محصول موجود
    const updated = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: sku.update },
      include: { product: true },
    });
    expect(updated.product.name).toBe(`نام تازه ${MARK}`);

    // Audit ثبت شد
    const audit = await prisma.auditLog.findFirst({ where: { entity: "ImportBatch", entityId: preview.batchId, action: "import.apply" } });
    expect(audit).toBeTruthy();

    // اعمال دوباره = بی‌اثر
    const again = await svc.apply(preview.batchId);
    expect(again.alreadyApplied).toBe(true);
    expect(await prisma.stockLedgerEntry.count({ where: { variantSku: sku.create } })).toBe(1);
  });

  it("بازگردانی: محصول تازه آرشیو، موجودی صفر، فیلد ویرایش‌شده به قبل؛ اجرای دوباره بی‌اثر", async () => {
    const batch = await prisma.importBatch.findFirstOrThrow({
      where: { status: "APPLIED", filename: "clean.csv" },
      orderBy: { createdAt: "desc" },
    });

    const r = await svc.revert(batch.id);
    expect(r.alreadyReverted).toBe(false);
    expect(r.reverted).toEqual({ CREATE: 1, UPDATE: 1 });

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: sku.create },
      include: { product: true },
    });
    expect(variant.product.deletedAt).not.toBeNull();
    expect(variant.deletedAt).not.toBeNull();
    expect(variant.stockQty).toBe(0);

    const ledger = await prisma.stockLedgerEntry.aggregate({
      where: { variantSku: sku.create },
      _sum: { qtyIn: true, qtyOut: true },
    });
    expect((ledger._sum.qtyIn ?? 0) - (ledger._sum.qtyOut ?? 0)).toBe(0);

    const restored = await prisma.productVariant.findUniqueOrThrow({
      where: { sku: sku.update },
      include: { product: true },
    });
    expect(restored.product.name).toBe(`محصول موجود 0 ${MARK}`);

    const after = await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(after.status).toBe("REVERTED");
    expect(after.revertedAt).not.toBeNull();

    const again = await svc.revert(batch.id);
    expect(again.alreadyReverted).toBe(true);
    expect(await prisma.stockLedgerEntry.count({ where: { variantSku: sku.create } })).toBe(2); // OPENING + CORRECTION
  });

  it("پیش‌نمایش کهنه: تغییر بیرونی بعد از پیش‌نمایش → PREVIEW_STALE (بدون نوشتن)", async () => {
    const text = csv([row({ sku: sku.stale, price: "130000" })]);
    const preview = await svc.preview({ filename: "stale.csv", text });
    batchIds.push(preview.batchId);
    expect(preview.counts.UPDATE).toBe(1);

    // کسی از پنل قیمت را عوض می‌کند
    await prisma.productVariant.update({ where: { sku: sku.stale }, data: { price: 140_000n } });

    await expect(svc.apply(preview.batchId)).rejects.toMatchObject({ response: { code: "PREVIEW_STALE" } });
    const v = await prisma.productVariant.findUniqueOrThrow({ where: { sku: sku.stale } });
    expect(v.price).toBe(140_000n); // دست‌نخورده
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: preview.batchId } });
    expect(batch.status).toBe("PREVIEWED");
  });

  it("بازگردانی فقط آخرین دستهٔ هر SKU: دستهٔ قدیمی‌تر رد می‌شود", async () => {
    const first = await svc.preview({ filename: "l1.csv", text: csv([row({ sku: sku.latest, price: "110000" })]) });
    batchIds.push(first.batchId);
    await svc.apply(first.batchId);

    const second = await svc.preview({ filename: "l2.csv", text: csv([row({ sku: sku.latest, name: "نام دوم" })]) });
    batchIds.push(second.batchId);
    await svc.apply(second.batchId);

    await expect(svc.revert(first.batchId)).rejects.toMatchObject({
      response: { code: "IMPORT_REVERT_NOT_LATEST" },
    });

    // آخرین دسته سالم برمی‌گردد
    const r = await svc.revert(second.batchId);
    expect(r.alreadyReverted).toBe(false);
  });

  it("مجوزها: پیش‌نمایش products.view · اعمال هر دو create+update · بازگردانی update", () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, ImportController.prototype.preview)).toEqual(["products.view"]);
    expect(Reflect.getMetadata(PERMISSION_KEY, ImportController.prototype.apply)).toEqual([
      "products.create",
      "products.update",
    ]);
    expect(Reflect.getMetadata(PERMISSION_KEY, ImportController.prototype.revert)).toEqual(["products.update"]);
    expect(normalizeKey("SKU")).toBe("sku");
  });

  it("مجوز کمتر از حد روی هندلر واقعی: فقط products.view → 403؛ با هر دو مجوز → عبور", () => {
    const reflector = {
      get: (_k: string, fn: unknown) => Reflect.getMetadata(PERMISSION_KEY, fn as object),
      getAllAndOverride: (_k: string, targets: unknown[]) => {
        for (const t of targets) {
          const v = Reflect.getMetadata(PERMISSION_KEY, t as object);
          if (v !== undefined) return v;
        }
        return undefined;
      },
    };
    const guard = new PermissionsGuard(reflector as never);
    const ctx = (permissions: string[]) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ adminIdentity: { permissions } }) }),
        getHandler: () => ImportController.prototype.apply,
        getClass: () => ImportController,
      }) as never;

    // فقط دیدن محصول → اعمال (که مینویسد) ممنوع است
    expect(() => guard.canActivate(ctx(["products.view"]))).toThrow(ForbiddenException);
    // فقط ویرایش، بدون ایجاد → همچنان ممنوع (نگهبان همهٔ موارد اعلام‌شده را می‌خواهد)
    expect(() => guard.canActivate(ctx(["products.update"]))).toThrow(ForbiddenException);
    expect(guard.canActivate(ctx(["products.create", "products.update"]))).toBe(true);
  });
});
