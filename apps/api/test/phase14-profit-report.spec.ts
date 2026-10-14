/**
 * موج ۳ — گزارش سود واقعی: اعداد کلی از JournalLine اسناد سفارش (فروش−بهای تمام‌شده)،
 * سود SKU از بهای میانگین دفتر انبار؛ SKUِ بدون بهای ثبت‌شده صادقانه null.
 * روی rehearsal اجرا می‌شود؛ ردیف‌های خودش را می‌سازد و پاک می‌کند.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { ProfitController } from "../src/reports/profit.controller";

jest.setTimeout(120_000);

describe("Phase 14 wave3 — real profit report", () => {
  let prisma: PrismaService;
  let ctl: ProfitController;
  let tag: string;
  let sku: string;
  let orderId: string;
  let entryId: string;
  let revAccountId: string;
  let cogsAccountId: string;
  let warehouseId: string;
  let variantSkuCreated = false;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    ctl = new ProfitController(prisma);
    tag = `pr-${Date.now()}`;
    sku = `TST-${tag}`;

    const rev = await prisma.account.findFirst({ where: { code: "4000" } });
    const cogs = await prisma.account.findFirst({ where: { code: "5000" } });
    if (!rev || !cogs) throw new Error("حساب‌های 4000/5000 در seed نیستند");
    revAccountId = rev.id;
    cogsAccountId = cogs.id;
    const wh = await prisma.warehouse.findFirst();
    warehouseId = wh!.id;
  });

  afterAll(async () => {
    // پاکسازی برعکس وابستگی‌ها
    if (entryId) await prisma.journalEntry.delete({ where: { id: entryId } }).catch(() => undefined);
    if (orderId) await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
    if (variantSkuCreated) {
      await prisma.stockLedgerEntry.deleteMany({ where: { variantSku: sku, idempotencyKey: { startsWith: `tst-${tag}` } } }).catch(() => undefined);
      await prisma.product.deleteMany({ where: { variants: { some: { sku } } } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it("سود SKU از بهای میانگین دفتر محاسبه و بهای نامشخص null برمی‌گردد", async () => {
    // محصول + واریانت با بهای آغازین 200،000 برای 10 عدد → WAC=200000
    await prisma.product.create({
      data: {
        name: "محصول سود تست",
        slug: `tst-${tag}`,
        status: "PUBLISHED",
        categoryId: (await prisma.category.findFirst())!.id,
        basePrice: 350_000n,
        publishedAt: new Date(),
        variants: { create: { sku, price: 350_000n, stockQty: 10 } },
      },
    });
    variantSkuCreated = true;
    const channel = await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "website" } });
    await prisma.stockLedgerEntry.create({
      data: {
        warehouseId,
        variantSku: sku,
        type: "OPENING",
        qtyIn: 10,
        balanceBefore: 0,
        balanceAfter: 10,
        unitCost: 200_000n,
        idempotencyKey: `tst-${tag}-opening`,
      },
    });

    // سفارش پرداخت‌شده: 2 عدد × 350000
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    const order = await prisma.order.create({
      data: {
        code: `TST-${tag}`,
        createdAt: new Date("2019-03-04T12:00:00.000Z"),
        channelId: channel!.id,
        warehouseId,
        guestName: "تست سود",
        guestMobile: "09120000000",
        addressSnapshot: {},
        status: "PAID",
        paymentStatus: "PAID",
        subtotal: 700_000n,
        shippingCost: 0n,
        discountTotal: 0n,
        total: 700_000n,
        items: {
          create: {
            variantId: variant.id,
            titleSnapshot: "محصول سود تست",
            qty: 2,
            unitPrice: 350_000n,
            lineTotal: 700_000n,
          },
        },
      },
      include: { items: true },
    });
    orderId = order.id;

    // سند GL فروش: Cr فروش 700000 / Dr COGS 400000
    const fy = await prisma.fiscalYear.findFirst({ where: { state: "OPEN" } });
    const entry = await prisma.journalEntry.create({
      data: {
        number: `TST-${tag}`,
        date: new Date("2019-03-04T12:00:00.000Z"),
        description: "سند تست گزارش سود",
        sourceType: "order",
        sourceId: order.id,
        state: "FINAL",
        fiscalYearId: fy!.id,
        lines: {
          create: [
            { accountId: revAccountId, credit: 700_000n },
            { accountId: cogsAccountId, debit: 400_000n },
          ],
        },
      },
    });
    entryId = entry.id;

    // پنجرهٔ انحصاری: اسناد و سفارشِ تست در گذشتهٔ دور تاریخ‌گذاری می‌شوند تا
    // اسناد فروش e2e که همزمان «الان» ثبت می‌شوند در مجموعِ اعداد کلی نشت نکنند.
    const QUIET = new Date("2019-03-04T12:00:00.000Z");
    const res = await ctl.profit({ from: new Date(QUIET.getTime() - 3600_000).toISOString(), to: new Date(QUIET.getTime() + 3600_000).toISOString() });

    // اعداد کلی از GL
    expect(res.revenue).toBe("700000");
    expect(res.cogs).toBe("400000");
    expect(res.grossProfit).toBe("300000");
    // سود SKU از بهای میانگین (200000) — سود واحد 150000 × 2
    const row = res.perSku.find((r) => r.sku === sku);
    expect(row).toBeDefined();
    expect(row!.qty).toBe(2);
    expect(row!.revenue).toBe("700000");
    expect(row!.cogs).toBe("400000");
    expect(row!.profit).toBe("300000");
    // سفارش بهای دارد → null نیست
    const po = res.perOrder.find((p) => p.code === `TST-${tag}`);
    expect(po!.cogs).toBe("400000");
    expect(po!.profit).toBe("300000");
  });

  it("SKUِ بدون بهای ثبت‌شده صادقانه نامشخص (null) می‌ماند", async () => {
    const tag2 = `${tag}-b`;
    const sku2 = `TST-${tag2}`;
    const channel = await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "website" } });
    await prisma.product.create({
      data: {
        name: "محصول بی‌بها",
        slug: `tst-${tag2}`,
        status: "PUBLISHED",
        categoryId: (await prisma.category.findFirst())!.id,
        basePrice: 100_000n,
        publishedAt: new Date(),
        variants: { create: { sku: sku2, price: 100_000n, stockQty: 3 } },
      },
    });
    const variant2 = await prisma.productVariant.findUniqueOrThrow({ where: { sku: sku2 } });
    const order = await prisma.order.create({
      data: {
        code: `TST-${tag2}`,
        channelId: channel!.id,
        warehouseId,
        guestName: "تست بی‌بها",
        guestMobile: "09120000001",
        addressSnapshot: {},
        status: "PAID",
        paymentStatus: "PAID",
        subtotal: 100_000n,
        shippingCost: 0n,
        discountTotal: 0n,
        total: 100_000n,
        items: {
          create: {
            variantId: variant2.id,
            titleSnapshot: "محصول بی‌بها",
            qty: 1,
            unitPrice: 100_000n,
            lineTotal: 100_000n,
          },
        },
      },
    });
    try {
      const res = await ctl.profit({});
      const row = res.perSku.find((r) => r.sku === sku2);
      expect(row).toBeDefined();
      expect(row!.cogs).toBeNull();
      expect(row!.profit).toBeNull();
      expect(res.itemsMissingCost).toBeGreaterThan(0);
      expect(res.missingCostSkus).toContain(sku2);
    } finally {
      await prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
      await prisma.product.deleteMany({ where: { variants: { some: { sku: sku2 } } } }).catch(() => undefined);
    }
  });
});
