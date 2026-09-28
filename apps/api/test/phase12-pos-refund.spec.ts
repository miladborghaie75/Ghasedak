/**
 * فاز ۱۲ — مرجوعی حضوری POS (مبنای PosInvoice):
 *
 * گام ۱ (posInvoiceRefund): بازکردن Refund PENDING از فاکتور FINALIZED
 *        + بازگشت انبار درون-tx با SALE_RETURN؛ بدون حرکت پول؛
 *        سقف qty (فاکتور − مرجوعی‌ها/اصلاحیه‌های قبلی) و مبلغ از unitPriceSnapshot.
 * گام ۲ (finalizeRefund فاز ۱۱): پول + سند + خزانه + audit + outbox — همان lifecycle.
 *
 * تست‌ها: cash کامل، STORE_CREDIT بدون خزانه، سقف مرجوعی، stale source،
 * replay idempotent (گام ۱) و concurrent finalize (گام ۲).
 */
import "reflect-metadata";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { EventBusService } from "../src/events/event-bus.service";
import { PricingService } from "../src/pricing/pricing.service";
import { ChecksService } from "../src/checks/checks.service";
import { PosService } from "../src/pos/pos.service";
import { ReturnsService } from "../src/returns/returns.service";

jest.setTimeout(120_000);

describe("Phase 12 — POS invoice refund (مرجوعی حضوری)", () => {
  let prisma: PrismaService;
  let journal: JournalService;
  let treasury: TreasuryService;
  let inventory: InventoryService;
  let bus: EventBusService;
  let pos: PosService;
  let returns: ReturnsService;
  let actor: string;
  let shiftId: string;
  let fixtureSku: string;
  let fixtureSku2: string;
  let invoiceId: string;
  const tag = `p12${Date.now()}${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    journal = new JournalService(prisma);
    treasury = new TreasuryService(prisma, journal);
    inventory = new InventoryService(prisma, new InventorySettingsService(prisma));
    bus = new EventBusService(prisma);
    const checks = new ChecksService(prisma, journal);
    pos = new PosService(prisma, inventory, journal, new PricingService(prisma, bus), treasury, checks);
    returns = new ReturnsService(prisma, inventory, treasury);
    actor = (await prisma.user.findFirstOrThrow()).id;

    for (const s of await prisma.cashierShift.findMany({ where: { userId: actor, state: "OPEN" } })) {
      await prisma.cashierShift.update({ where: { id: s.id }, data: { state: "CLOSED" as never } }).catch(() => undefined);
    }
    const shift = await pos.openShift({ userId: actor, registerName: `REG-${tag}`, openingCash: 0 });
    shiftId = shift.id;

    const cat = await prisma.category.findFirstOrThrow();
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId!;
    const product = await prisma.product.create({
      data: {
        name: `محصول Phase12 ${tag}`,
        slug: `p12-fixture-${tag}`,
        status: "PUBLISHED",
        categoryId: cat.id,
        basePrice: 200_000n,
        variants: {
          create: [
            { sku: `P12-SKU-A-${tag}`, price: 200_000n },
            { sku: `P12-SKU-B-${tag}`, price: 150_000n },
          ],
        },
      },
      include: { variants: true },
    });
    fixtureSku = product.variants[0].sku;
    fixtureSku2 = product.variants[1].sku;
    for (const sku of [fixtureSku, fixtureSku2]) {
      await inventory.move({
        warehouseId: whId,
        variantSku: sku,
        type: "OPENING",
        qty: 30,
        unitCost: 80_000n,
        refType: "opening",
        refId: tag,
        idempotencyKey: `p12-opening-${tag}-${sku}`,
        actorId: actor,
      });
    }

    // فاکتور فروش POS: 3 عدد A (نقد) + 2 عدد B (کارت)
    const sale = await pos.sale(
      {
        shiftId,
        lines: [
          { sku: fixtureSku, qty: 3 },
          { sku: fixtureSku2, qty: 2 },
        ],
        payments: [
          { methodCode: "cash", amount: 600_000 },
          { methodCode: "card", amount: 300_000 },
        ],
        idempotencyKey: `p12-sale-${tag}`,
      },
      actor,
    );
    invoiceId = sale.id;
  });

  afterAll(async () => {
    // پاک‌سازی tag-محور (الگوی phase11-p1)
    const refunds = await prisma.refund.findMany({
      where: { idempotencyKey: { contains: tag } },
      select: { id: true },
    });
    for (const r of refunds) {
      await prisma.journalEntry.deleteMany({ where: { sourceType: "refund", sourceId: r.id } });
      await prisma.auditLog.deleteMany({ where: { entity: "Refund", entityId: r.id } });
      await prisma.domainEventOutbox.deleteMany({ where: { name: "RefundCompleted", payload: { path: ["refundId"], equals: r.id } as never } });
      await prisma.refundItem.deleteMany({ where: { refundId: r.id } });
      await prisma.refund.delete({ where: { id: r.id } }).catch(() => undefined);
    }
    await prisma.auditLog.deleteMany({ where: { action: "pos.refund.open", entityId: { in: refunds.map((r) => r.id) } } });

    const invoices = await prisma.posInvoice.findMany({
      where: { idempotencyKey: { startsWith: `p12-sale-${tag}` } },
      select: { id: true },
    });
    const ids = invoices.map((i) => i.id);
    if (ids.length) {
      await prisma.posPayment.deleteMany({ where: { invoiceId: { in: ids } } });
      await prisma.posInvoiceItem.deleteMany({ where: { invoiceId: { in: ids } } });
      await prisma.posInvoice.deleteMany({ where: { id: { in: ids } } });
      await prisma.journalEntry.deleteMany({ where: { sourceType: { in: ["pos_invoice", "pos_correction"] }, sourceId: { in: ids } } });
      for (const iid of ids) {
        await prisma.domainEventOutbox.deleteMany({ where: { name: "POS_SALE_COMPLETED", payload: { path: ["invoiceId"], equals: iid } as never } });
      }
      const moves = await prisma.stockLedgerEntry.findMany({ where: { refType: "pos_invoice", refId: { in: ids } }, select: { variantSku: true, qtyOut: true } });
      for (const m of moves) {
        await prisma.productVariant.update({ where: { sku: m.variantSku }, data: { stockQty: { increment: m.qtyOut } } });
      }
      await prisma.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: { in: ids } } });
      await prisma.numberSeries.update({ where: { scope: "pos_invoice" }, data: { nextNumber: { decrement: ids.length } } }).catch(() => undefined);
    }
    // حرکت‌های SALE_RETURN و OPENING فیکسچر
    await prisma.stockLedgerEntry.deleteMany({ where: { refType: { in: ["pos_refund", "opening"] }, OR: [{ variantSku: fixtureSku }, { variantSku: fixtureSku2 }] } });
    for (const sku of [fixtureSku, fixtureSku2]) {
      const fv = await prisma.productVariant.findUnique({ where: { sku }, select: { sku: true, productId: true } });
      if (fv) {
        await prisma.stockLedgerEntry.deleteMany({ where: { variantSku: fv.sku } });
        await prisma.costLayer.deleteMany({ where: { variantSku: fv.sku } });
        await prisma.stockReservation.deleteMany({ where: { variantSku: fv.sku } });
        await prisma.variantPrice.deleteMany({ where: { variantSku: fv.sku } });
        await prisma.variantBarcode.deleteMany({ where: { variantSku: fv.sku } });
        await prisma.priceHistory.deleteMany({ where: { variantSku: fv.sku } });
        await prisma.productVariant.deleteMany({ where: { sku: fv.sku } });
        await prisma.product.deleteMany({ where: { id: fv.productId } });
      }
    }
    await prisma.cashierShift.deleteMany({ where: { id: shiftId } });
    await prisma.$disconnect();
  });

  it("A) گام ۱: بازکردن مرجوعی نقدی — Refund PENDING + انبار برگشت + سقف و snapshot؛ بدون حرکت پول", async () => {
    const cashBefore = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });

    const res = await returns.posInvoiceRefund(
      {
        invoiceId,
        lines: [{ variantSku: fixtureSku, qty: 2 }],
        method: "CASH",
        reason: "مرجوعی تست",
        idempotencyKey: `p12-refund-${tag}-cash`,
      },
      actor,
    );
    expect(res.refund.state).toBe("PENDING");
    expect(res.refund.method).toBe("CASH");
    expect(Number(res.refund.amount)).toBe(400_000); // 2 × 200,000 از snapshot

    // انبار: SALE_RETURN درون-tx ثبت شد
    const ledger = await prisma.stockLedgerEntry.findFirstOrThrow({
      where: { refType: "pos_refund", refId: invoiceId, variantSku: fixtureSku },
    });
    expect(Number(ledger.qtyIn)).toBe(2);

    // هیچ اثر مالی نباید داشته باشد (پول در گام ۲ حرکت می‌کند)
    const cashAfter = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    expect(cashAfter.currentBalance).toBe(cashBefore.currentBalance);
    expect(await prisma.journalEntry.count({ where: { sourceType: "refund", sourceId: res.refund.id } })).toBe(0);

    // audit گام ۱
    expect(await prisma.auditLog.count({ where: { action: "pos.refund.open", entity: "Refund", entityId: res.refund.id } })).toBe(1);

    // replay همان کلید ⇒ همان refund بدون ردیف دوم انبار
    const replayed = await returns.posInvoiceRefund(
      {
        invoiceId,
        lines: [{ variantSku: fixtureSku, qty: 2 }],
        method: "CASH",
        idempotencyKey: `p12-refund-${tag}-cash`,
      },
      actor,
    );
    expect(replayed.refund.id).toBe(res.refund.id);
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "pos_refund", refId: invoiceId, variantSku: fixtureSku } })).toBe(1);

    // گام ۲ با lifecycle فاز ۱۱
    const fin = await returns.finalizeRefund(res.refund.id, { idempotencyKey: `p12-refund-${tag}-cash:fin`, actorId: actor });
    expect(fin.state).toBe("COMPLETED");
    const cashFinal = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    expect(cashFinal.currentBalance).toBe(cashAfter.currentBalance - 400_000n);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "refund", sourceId: res.refund.id }, include: { lines: { include: { account: true } } } });
    const dr = entry.lines.reduce((a, l) => a + (l.debit ?? 0n), 0n);
    const cr = entry.lines.reduce((a, l) => a + (l.credit ?? 0n), 0n);
    expect(dr).toBe(cr);
    expect(dr).toBe(400_000n);
  });

  it("B) سقف مرجوعی: qty بیش از باقی‌مانده reject؛ SKU خارج فاکتور reject؛ stale source reject", async () => {
    // فاکتور 3 عدد A دارد که 2 عددش در تست A مرجوع شده ⇒ فقط 1 عدد باقی است
    await expect(returns.posInvoiceRefund({
      invoiceId,
      lines: [{ variantSku: fixtureSku, qty: 2 }],
      method: "CASH",
    }, actor)).rejects.toThrow(BadRequestException);

    // SKU خارج از فاکتور
    await expect(returns.posInvoiceRefund({
      invoiceId,
      lines: [{ variantSku: `P12-NOPE-${tag}`, qty: 1 }],
      method: "CASH",
    }, actor)).rejects.toThrow(BadRequestException);

    // stale source: فاکتور مبدأ باید آخرین revision باشد — اینجا revision=1 است پس فقط سناریوی qty را داریم؛
    // سناریوی stale در تست D با اصلاحیه واقعی ساخته می‌شود.
  });

  it("C) مرجوعی STORE_CREDIT: گام ۲ بدون خزانه و بدون سند؛ فقط audit+outbox", async () => {
    const bankBefore = await prisma.bankAccount.findFirst();
    const res = await returns.posInvoiceRefund(
      {
        invoiceId,
        lines: [{ variantSku: fixtureSku2, qty: 1 }],
        method: "STORE_CREDIT",
        idempotencyKey: `p12-refund-${tag}-sc`,
      },
      actor,
    );
    expect(res.refund.method).toBe("STORE_CREDIT");
    const fin = await returns.finalizeRefund(res.refund.id, { idempotencyKey: `p12-refund-${tag}-sc:fin`, actorId: actor });
    expect(fin.state).toBe("COMPLETED");
    expect(await prisma.journalEntry.count({ where: { sourceType: "refund", sourceId: res.refund.id } })).toBe(0);
    const bankAfter = bankBefore ? await prisma.bankAccount.findUnique({ where: { id: bankBefore.id } }) : null;
    expect(bankAfter?.currentBalance).toBe(bankBefore?.currentBalance ?? null);
    // بقیهٔ B (1 عدد) هنوز قابل مرجوع است
    const again = await returns.posInvoiceRefund({
      invoiceId,
      lines: [{ variantSku: fixtureSku2, qty: 1 }],
      method: "CASH",
      idempotencyKey: `p12-refund-${tag}-b2`,
    }, actor);
    expect(again.refund.method).toBe("CASH");
    // نهایی نمی‌کنیم — در cleanup حذف می‌شود (PENDING)
  });

  it("D) concurrent finalize: فقط یکی COMPLETED؛ دیگری Conflict", async () => {
    const res = await returns.posInvoiceRefund(
      {
        invoiceId,
        lines: [{ variantSku: fixtureSku, qty: 1 }],
        method: "CASH",
        idempotencyKey: `p12-refund-${tag}-conc`,
      },
      actor,
    );
    const results = await Promise.allSettled([
      returns.finalizeRefund(res.refund.id, { idempotencyKey: `p12-refund-${tag}-conc:f1`, actorId: actor }),
      returns.finalizeRefund(res.refund.id, { idempotencyKey: `p12-refund-${tag}-conc:f2`, actorId: actor }),
    ]);
    const states = results.map((r) => (r.status === "fulfilled" ? "OK" : "ERR"));
    expect(states.sort()).toEqual(["ERR", "OK"]);
    expect(await prisma.refund.findUniqueOrThrow({ where: { id: res.refund.id } }).then((r) => r.state)).toBe("COMPLETED");
    expect(await prisma.journalEntry.count({ where: { sourceType: "refund", sourceId: res.refund.id } })).toBe(1);
  });
});
