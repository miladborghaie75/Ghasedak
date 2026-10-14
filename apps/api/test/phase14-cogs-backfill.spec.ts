/**
 * F0-2 — بازپرکردن «بهای تمام‌شدهٔ عقب‌افتاده» (گام ۳ نقشهٔ راه).
 *
 * سناریوی واقعی باگ: سند فروش در لحظهٔ پرداخت بدون سطر 5000 ثبت می‌شود
 * (WAC آن SKU هنوز معلوم نبود). بعداً که بها معلوم می‌شود:
 *  ۱) سند مکمل Dr 5000 / Cr موجودی ثبت می‌شود (idempotent + Audit).
 *  ۲) KPI گزارش سود (از GL) دقیقاً با جدول هر-سفارش (از WAC) یکی می‌شود.
 *  ۳) سفارش بدون بهای ثبت‌شده صادقانه NO_COST می‌ماند — سند ساختگی نه.
 *
 * روی rehearsal اجرا می‌شود؛ ردیف‌های خودش را می‌سازد و پاک می‌کند.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { JournalService } from "../src/accounting/journal.service";
import { CogsBackfillService } from "../src/accounting/cogs-backfill.service";
import { ProfitController } from "../src/reports/profit.controller";

jest.setTimeout(120_000);

/** پنجرهٔ ساکت — دور از داده‌های e2e (امروز) و تست سود (۲۰۱۹) */
const QUIET = new Date("2018-08-08T12:00:00.000Z");

describe("F0-2 — COGS backfill: KPI = جدول", () => {
  let prisma: PrismaService;
  let cogs: CogsBackfillService;
  let profit: ProfitController;
  let tag: string;
  let sku: string;
  let orderId: string;
  let orderCode: string;
  let warehouseId: string;
  let channelId: string;
  let fiscalYearId: string;
  let revAccountId: string;
  let bankAccountId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    profit = new ProfitController(prisma);
    const inv = new InventoryService(prisma, new InventorySettingsService(prisma));
    const journal = new JournalService(prisma);
    cogs = new CogsBackfillService(prisma, inv, journal);

    tag = `cb-${Date.now()}`;
    sku = `TST-${tag}`;

    const rev = await prisma.account.findFirst({ where: { code: "4000" } });
    const bank = await prisma.account.findFirst({ where: { code: "1100" } });
    const fy = await prisma.fiscalYear.findFirst({ where: { state: "OPEN" } });
    if (!rev || !bank || !fy) throw new Error("پیش‌نیاز seed (4000/1100/سال مالی باز) کامل نیست");
    revAccountId = rev.id;
    bankAccountId = bank.id;
    fiscalYearId = fy.id;
    warehouseId = (await prisma.warehouse.findFirstOrThrow()).id;
    channelId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "website" } })).id;
  });

  afterAll(async () => {
    // پاک‌سازی کامل ردیف‌های این تست (برعکس وابستگی)
    if (orderId) {
      await prisma.journalEntry.deleteMany({ where: { sourceId: orderId, sourceType: { in: ["order", "order-cogs-backfill"] } } }).catch(() => undefined);
      await prisma.auditLog.deleteMany({ where: { entityId: orderId, action: "accounting.cogs.backfill" } }).catch(() => undefined);
      await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
    }
    await prisma.stockLedgerEntry.deleteMany({ where: { idempotencyKey: { startsWith: `tst-${tag}` } } }).catch(() => undefined);
    await prisma.product.deleteMany({ where: { slug: `tst-${tag}` } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it("سند مکمل ثبت می‌شود، KPI با جدول یکی می‌شود، اجرای دوباره سند نمی‌سازد", async () => {
    // ── فیکسچر: سفارش پرداخت‌شده با سند فروش «بدون COGS» (شبیه‌سازی باگ لحظهٔ پرداخت) ──
    await prisma.product.create({
      data: {
        name: "محصول تست COGS",
        slug: `tst-${tag}`,
        status: "PUBLISHED",
        categoryId: (await prisma.category.findFirstOrThrow()).id,
        basePrice: 300_000n,
        publishedAt: new Date(),
        variants: { create: { sku, price: 300_000n, stockQty: 2 } },
      },
    });
    const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku } });
    const order = await prisma.order.create({
      data: {
        code: `TST-${tag}`,
        createdAt: QUIET,
        channelId,
        warehouseId,
        guestName: "تست COGS",
        guestMobile: "09120000002",
        addressSnapshot: {},
        status: "PAID",
        paymentStatus: "PAID",
        subtotal: 600_000n,
        shippingCost: 0n,
        discountTotal: 0n,
        total: 600_000n,
        items: {
          create: {
            variantId: variant.id,
            titleSnapshot: "محصول تست COGS",
            qty: 2,
            unitPrice: 300_000n,
            lineTotal: 600_000n,
          },
        },
      },
      include: { items: true },
    });
    orderId = order.id;
    orderCode = order.code;

    await prisma.journalEntry.create({
      data: {
        number: `TST-${tag}`,
        date: QUIET,
        description: "سند فروش تست (بدون COGS)",
        sourceType: "order",
        sourceId: order.id,
        state: "FINAL",
        fiscalYearId,
        lines: {
          create: [
            { accountId: bankAccountId, debit: 600_000n },
            { accountId: revAccountId, credit: 600_000n },
          ],
        },
      },
    });

    const win = { from: new Date(QUIET.getTime() - 3600_000).toISOString(), to: new Date(QUIET.getTime() + 3600_000).toISOString() };
    // پنجرهٔ پهن: از فروش تا «الان» — سند مکمل در دورهٔ جاری (امروز) ثبت می‌شود،
    // مثل واقعیت: کشف بهای عقب‌افتاده در دورهٔ جاری شناسایی می‌شود نه دورهٔ بسته.
    const wide = { from: new Date(QUIET.getTime() - 3600_000).toISOString(), to: new Date(Date.now() + 3600_000).toISOString() };
    const base = await profit.profit(wide); // قبل از معلوم‌شدن بها

    // ── قبل: KPI (GL) صفر است ولی جدول سفارش هم null (بهای نامشخص) ──
    {
      const res = await profit.profit(win);
      expect(res.cogs).toBe("0");
      const po = res.perOrder.find((p) => p.code === orderCode);
      expect(po).toBeDefined();
      expect(po!.cogs).toBeNull();
      expect(res.missingCostSkus).toContain(sku);
    }

    // ── بها معلوم می‌شود: OPENING با بهای واحد 84,000 (WAC = 84,000) ──
    await prisma.stockLedgerEntry.create({
      data: {
        warehouseId,
        variantSku: sku,
        type: "OPENING",
        qtyIn: 5,
        balanceBefore: 0,
        balanceAfter: 5,
        unitCost: 84_000n,
        idempotencyKey: `tst-${tag}-opening`,
        note: "تست COGS backfill",
      },
    });

    // ── ناهماهنگی زنده: جدول بهای جدید را دارد ولی KPI (GL) هنوز نه ──
    const preWide = await profit.profit(wide);
    expect(preWide.cogs).toBe(base.cogs);
    const preRow = preWide.perOrder.find((p) => p.code === orderCode);
    expect(preRow!.cogs).toBe("168000"); // جدول از WAC می‌داند

    // ── اقدام: بازپرکردن ──
    const r = await cogs.backfillOrder(orderId);
    expect(r.posted).toBe(true);
    expect(r.amount).toBe("168000"); // 2 × 84,000
    expect(r.entryNumber).toBeTruthy();

    // سند مکمل واقعاً Dr 5000 / Cr موجودی است
    const back = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "order-cogs-backfill", sourceId: orderId },
      include: { lines: { include: { account: true } } },
    });
    const dr = back.lines.find((l) => l.account.code === "5000");
    expect(dr?.debit).toBe(168_000n);
    const creditLine = back.lines.find((l) => l.credit > 0n);
    expect(creditLine?.credit).toBe(168_000n);
    expect(creditLine?.account.code.startsWith("1200")).toBe(true);

    // ── بعد: KPI (GL) دقیقاً به اندازهٔ جدول بالا رفت — قلب پذیرش F0-2 ──
    {
      const res = await profit.profit(wide);
      const po = res.perOrder.find((p) => p.code === orderCode);
      expect(po).toBeDefined();
      expect(po!.cogs).toBe("168000");
      expect(po!.profit).toBe("432000");
      // تناظر یک-به-یک: افزایش KPI = عدد جدول همین سفارش
      expect(BigInt(res.cogs) - BigInt(base.cogs)).toBe(168_000n);
      expect(res.missingCostSkus).not.toContain(sku);
      // حاشیهٔ سفارش نمونه: (600,000 − 168,000) / 600,000 = ۷۲٪
      expect(Number((BigInt(po!.profit!) * 10000n) / 600_000n) / 100).toBe(72);
    }

    // ── Idempotency: اجرای دوباره سند دوم نمی‌سازد ──
    const again = await cogs.backfillOrder(orderId);
    expect(again.posted).toBe(false);
    expect(again.reason).toBe("ALREADY_BACKFILLED");
    const count = await prisma.journalEntry.count({ where: { sourceType: "order-cogs-backfill", sourceId: orderId } });
    expect(count).toBe(1);

    // ── Audit اکشن ادمین ──
    const audits = await prisma.auditLog.count({ where: { action: "accounting.cogs.backfill", entityId: orderId } });
    expect(audits).toBe(1);
  });

  it("سفارش بدون بهای ثبت‌شده صادقانه NO_COST می‌ماند (بدون سند ساختگی)", async () => {
    const tag2 = `${tag}-2`;
    const sku2 = `TST-${tag2}`;
    await prisma.product.create({
      data: {
        name: "محصول بی‌بهای COGS",
        slug: `tst-${tag2}`,
        status: "PUBLISHED",
        categoryId: (await prisma.category.findFirstOrThrow()).id,
        basePrice: 100_000n,
        publishedAt: new Date(),
        variants: { create: { sku: sku2, price: 100_000n, stockQty: 1 } },
      },
    });
    const v2 = await prisma.productVariant.findUniqueOrThrow({ where: { sku: sku2 } });
    const o2 = await prisma.order.create({
      data: {
        code: `TST-${tag2}`,
        createdAt: QUIET,
        channelId,
        warehouseId,
        guestName: "تست بی‌بها",
        guestMobile: "09120000003",
        addressSnapshot: {},
        status: "PAID",
        paymentStatus: "PAID",
        subtotal: 100_000n,
        shippingCost: 0n,
        discountTotal: 0n,
        total: 100_000n,
        items: {
          create: { variantId: v2.id, titleSnapshot: "محصول بی‌بها COGS", qty: 1, unitPrice: 100_000n, lineTotal: 100_000n },
        },
      },
    });

    try {
      const r = await cogs.backfillOrder(o2.id);
      expect(r.posted).toBe(false);
      expect(r.reason).toBe("NO_COST");
      expect(r.missingSkus).toContain(sku2);
      const entries = await prisma.journalEntry.count({ where: { sourceType: "order-cogs-backfill", sourceId: o2.id } });
      expect(entries).toBe(0);
    } finally {
      await prisma.order.delete({ where: { id: o2.id } }).catch(() => undefined);
      await prisma.stockLedgerEntry.deleteMany({ where: { idempotencyKey: { startsWith: `tst-${tag2}` } } }).catch(() => undefined);
      await prisma.product.deleteMany({ where: { slug: `tst-${tag2}` } }).catch(() => undefined);
    }
  });
});
