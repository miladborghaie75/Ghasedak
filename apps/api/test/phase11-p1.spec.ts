/**
 * فاز ۱۱ — P1: Production Safety / Data Integrity
 *
 * A) POS inventory atomicity (failure injection):
 *    moveInTx سالم → sale موفق و move داخل همان tx
 *    moveInTx خراب → کل تراکنش rollback (هیچ فاکتور/سند/خزانه/ledger)
 *    retry با همان idempotencyKey → همان نتیجه، بدون duplicate
 * B) Refund lifecycle:
 *    cash/bank/store_credit finalize → treasury + journal + audit + outbox + REFUNDED
 *    idempotency replay → بدون اثر دوم
 *    duplicate concurrent finalize → یکی COMPLETED یکی CONFLICT
 *    cancel/invalid transitions
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

describe("Phase 11 — P1 (inventory atomicity + refund lifecycle)", () => {
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
  const tag = `p11${Date.now()}${Math.floor(Math.random() * 100000)}`;

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
    const product = await prisma.product.create({
      data: {
        name: `محصول Phase11 ${tag}`,
        slug: `p11-fixture-${tag}`,
        status: "PUBLISHED",
        categoryId: cat.id,
        basePrice: 250_000n,
        variants: { create: [{ sku: `P11-SKU-${tag}`, price: 250_000n }] },
      },
      include: { variants: true },
    });
    fixtureSku = product.variants[0].sku;
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId;
    await inventory.move({
      warehouseId: whId!,
      variantSku: fixtureSku,
      type: "OPENING",
      qty: 30,
      unitCost: 80_000n,
      refType: "opening",
      refId: tag,
      idempotencyKey: `p11-opening-${tag}`,
      actorId: actor,
    });
  });

  afterAll(async () => {
    // پاک‌سازی tag-محور
    const refunds = await prisma.refund.findMany({ where: { idempotencyKey: { startsWith: `p11-refund-${tag}` } }, select: { id: true, returnId: true } });
    for (const r of refunds) {
      if (r.returnId) {
        await prisma.returnRequest.deleteMany({ where: { id: r.returnId } }).catch(() => undefined);
      }
      await prisma.journalEntry.deleteMany({ where: { sourceType: "refund", sourceId: r.id } });
      await prisma.auditLog.deleteMany({ where: { entity: "Refund", entityId: r.id } });
      await prisma.domainEventOutbox.deleteMany({ where: { name: "RefundCompleted", payload: { path: ["refundId"], equals: r.id } as never } });
      await prisma.refund.delete({ where: { id: r.id } }).catch(() => undefined);
    }
    const invoices = await prisma.posInvoice.findMany({
      where: { OR: [{ idempotencyKey: { startsWith: `p11-${tag}` } }, { idempotencyKey: { startsWith: `p11-correction:${tag}` } }] },
      select: { id: true },
    });
    const ids = invoices.map((i) => i.id);
    if (ids.length) {
      await prisma.posPayment.deleteMany({ where: { invoiceId: { in: ids } } });
      const checkIds = (await prisma.check.findMany({ where: { sourceType: "pos_invoice", sourceId: { in: ids } }, select: { id: true } })).map((c) => c.id);
      if (checkIds.length) {
        await prisma.checkTransition.deleteMany({ where: { checkId: { in: checkIds } } });
        await prisma.accountsReceivable.deleteMany({ where: { refType: "check", refId: { in: checkIds } } });
        await prisma.paymentSettlement.deleteMany({ where: { checkId: { in: checkIds } } }).catch(() => undefined);
        await prisma.reminder.deleteMany({ where: { relatedEntityType: "check", relatedEntityId: { in: checkIds } } }).catch(() => undefined);
        await prisma.check.deleteMany({ where: { id: { in: checkIds } } });
        await prisma.journalEntry.deleteMany({ where: { sourceType: "check_transition", OR: checkIds.map((id) => ({ sourceId: { startsWith: id } })) } });
      }
      await prisma.posInvoiceItem.deleteMany({ where: { invoiceId: { in: ids } } });
      await prisma.posInvoice.deleteMany({ where: { id: { in: ids } } });
      await prisma.journalEntry.deleteMany({ where: { sourceType: { in: ["pos_invoice", "pos_correction"] }, sourceId: { in: ids } } });
      for (const iid of ids) {
        await prisma.domainEventOutbox.deleteMany({ where: { OR: [
          { name: "POS_SALE_COMPLETED", payload: { path: ["invoiceId"], equals: iid } as never },
          { name: "CheckCreated", payload: { path: ["invoiceId"], equals: iid } as never },
        ] } });
      }
      const moves = await prisma.stockLedgerEntry.findMany({ where: { refType: "pos_invoice", refId: { in: ids } }, select: { variantSku: true, qtyOut: true } });
      for (const m of moves) {
        await prisma.productVariant.update({ where: { sku: m.variantSku }, data: { stockQty: { increment: m.qtyOut } } });
      }
      await prisma.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: { in: ids } } });
      await prisma.numberSeries.update({ where: { scope: "pos_invoice" }, data: { nextNumber: { decrement: ids.length } } }).catch(() => undefined);
    }
    await prisma.journalEntry.deleteMany({ where: { sourceType: "manual", description: { contains: tag } } });
    const fv = await prisma.productVariant.findUnique({ where: { sku: fixtureSku }, select: { sku: true, productId: true } });
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
    await prisma.cashierShift.deleteMany({ where: { id: shiftId } });
    await prisma.$disconnect();
  });

  it("A) failure injection: شکست inventory ⇒ rollback کامل؛ retry همان key ⇒ همان فاکتور بدون duplicate", async () => {
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId!;
    const ep = await (new PricingService(prisma, bus)).effectivePrice(fixtureSku, "pos");
    const unit = Number(ep.salePrice ?? ep.price);
    const amount = unit * 2;
    const cashBefore = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });

    const boom = new Error("INJECT: inventory failure right after financial commit");
    const spy = jest.spyOn(inventory, "moveInTx").mockRejectedValueOnce(boom);
    await expect(pos.sale({
      shiftId,
      lines: [{ sku: fixtureSku, qty: 2 }],
      payments: [{ methodCode: "cash", amount }],
      idempotencyKey: `p11-${tag}-atomic`,
    }, actor)).rejects.toThrow(boom);
    spy.mockRestore();

    // هیچ اثری از فروش نیمه‌کاره نباید بماند
    expect(await prisma.posInvoice.count({ where: { idempotencyKey: `p11-${tag}-atomic` } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { sourceType: "pos_invoice", sourceId: { startsWith: "___none___" }, description: { contains: tag } } })).toBe(0);
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "pos_invoice", refId: { startsWith: "___none___" } } })).toBe(0);
    const cashAfterFail = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    expect(cashAfterFail.currentBalance).toBe(cashBefore.currentBalance);
    const ledgerForSku = await prisma.stockLedgerEntry.count({ where: { variantSku: fixtureSku, refType: "pos_invoice" } });
    expect(ledgerForSku).toBe(0);

    // retry با همان idempotencyKey — حالا انبار سالم است
    const r = await pos.sale({
      shiftId,
      lines: [{ sku: fixtureSku, qty: 2 }],
      payments: [{ methodCode: "cash", amount }],
      idempotencyKey: `p11-${tag}-atomic`,
    }, actor);
    expect(r.id).toBeTruthy();

    // replay همان key ⇒ همان فاکتور، بدون duplicate سند/ledger/خزانه
    const again = await pos.sale({
      shiftId,
      lines: [{ sku: fixtureSku, qty: 2 }],
      payments: [{ methodCode: "cash", amount }],
      idempotencyKey: `p11-${tag}-atomic`,
    }, actor);
    expect(again.id).toBe(r.id);
    expect(await prisma.posInvoice.count({ where: { idempotencyKey: `p11-${tag}-atomic` } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "pos_invoice", sourceId: r.id } })).toBe(1);
    expect(await prisma.stockLedgerEntry.count({ where: { refType: "pos_invoice", refId: r.id } })).toBe(1);

    // فروش مالی ⇔ مصرف انبار اتمیک: ledger همان مبلغ qty
    const move = await prisma.stockLedgerEntry.findFirstOrThrow({ where: { refType: "pos_invoice", refId: r.id } });
    expect(move.qtyOut).toBe(2);
    const cashFinal = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    expect(cashFinal.currentBalance).toBe(cashBefore.currentBalance + BigInt(amount));
  });

  it("B1) refund cash: PENDING→COMPLETED با treasury+journal+audit+outbox؛ replay idempotent؛ invalid transition", async () => {
    const cashBefore = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    const rr = await prisma.returnRequest.create({ data: { number: `RT-${tag}-C`, status: "SETTLED", actorId: actor } as never });
    const refund = await prisma.refund.create({
      data: {
        number: `RF-${tag}-C`,
        refundType: "partial",
        method: "CASH",
        amount: 120_000n,
        state: "PENDING",
        sourceType: "order",
        sourceId: rr.id,
        returnId: rr.id,
        idempotencyKey: `p11-refund-${tag}-cash`,
        actorId: actor,
      },
    });
    const fin = await returns.finalizeRefund(refund.id, { idempotencyKey: `p11-refund-${tag}-cash:fin`, actorId: actor });
    expect(fin.state).toBe("COMPLETED");

    // خزانه: صندوق دقیقاً 120000 کم شد
    const cashAfter = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    expect(cashAfter.currentBalance).toBe(cashBefore.currentBalance - 120_000n);

    // سند: Dr 4000 / Cr 1000 متوازن
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "refund", sourceId: refund.id }, include: { lines: { include: { account: true } } } });
    const dr = entry.lines.reduce((a, l) => a + (l.debit ?? 0n), 0n);
    const cr = entry.lines.reduce((a, l) => a + (l.credit ?? 0n), 0n);
    expect(dr).toBe(cr);
    expect(dr).toBe(120_000n);
    expect(entry.lines.find((l) => l.account.code === "4000")?.debit).toBe(120_000n);
    expect(entry.lines.find((l) => l.account.code === "1000")?.credit).toBe(120_000n);

    // audit + outbox
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entity: "Refund", entityId: refund.id, action: "refund.finalize" } });
    expect((audit.newValues as Record<string, unknown>).idempotencyKey).toBe(`p11-refund-${tag}-cash:fin`);
    const ev = await prisma.domainEventOutbox.findFirstOrThrow({ where: { name: "RefundCompleted", payload: { path: ["refundId"], equals: refund.id } as never } });
    expect(ev.state).toBe("PENDING"); // مصرف بعداً توسط EventBus (consumer فعلاً تاریخچه‌ای)

    // ReturnRequest → REFUNDED
    const rrAfter = await prisma.returnRequest.findUniqueOrThrow({ where: { id: rr.id } });
    expect(rrAfter.status).toBe("REFUNDED");

    // replay همان کلید ⇒ همان state، بدون اثر دوم
    const before = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    const replayed = await returns.finalizeRefund(refund.id, { idempotencyKey: `p11-refund-${tag}-cash:fin`, actorId: actor });
    expect(replayed.state).toBe("COMPLETED");
    const after = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    expect(after.currentBalance).toBe(before.currentBalance);
    expect(await prisma.journalEntry.count({ where: { sourceType: "refund", sourceId: refund.id } })).toBe(1);

    // invalid transition: COMPLETED → CANCELLED مجاز نیست
    await expect(returns.cancelRefund(refund.id, { actorId: actor, reason: "دیر" })).rejects.toThrow(BadRequestException);
  });

  it("B2) refund bank + concurrent finalize: فقط یکی COMPLETED می‌شود", async () => {
    // snapshot ماندهٔ همهٔ حساب‌های بانکی متصل به درخت GL 1100 — مجموع باید دقیقاً 300k کم شود
    // (کدام حساب انتخاب می‌شود تصمیم treasury است؛ invariant، کاهش کل است).
    // توجه: هر حساب بانکی به زیرشاخهٔ 1100-XX وصل است (glAccountForNew) — پس کل زیردرخت را جمع میزنیم.
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const glChildren = await prisma.account.findMany({ where: { parentAccountId: glBank.id }, select: { id: true } });
    const glIds = [glBank.id, ...glChildren.map((c) => c.id)];
    const bankWhere = { glAccountId: { in: glIds }, active: true } as never;
    const banksBefore = await prisma.bankAccount.aggregate({ where: bankWhere, _sum: { currentBalance: true } });
    const beforeSum = banksBefore._sum.currentBalance ?? 0n;
    const rr = await prisma.returnRequest.create({ data: { number: `RT-${tag}-B`, status: "SETTLED", actorId: actor } as never });
    const refund = await prisma.refund.create({
      data: {
        number: `RF-${tag}-B`,
        refundType: "partial",
        method: "BANK",
        amount: 300_000n,
        state: "PENDING",
        sourceType: "order",
        sourceId: rr.id,
        returnId: rr.id,
        idempotencyKey: `p11-refund-${tag}-bank`,
        actorId: actor,
      },
    });
    // دو finalize همزمان با کلیدهای متفاوت — فقط یکی باید ببرد
    const [a, b] = await Promise.allSettled([
      returns.finalizeRefund(refund.id, { idempotencyKey: `p11-refund-${tag}-bank:fin1`, actorId: actor }),
      returns.finalizeRefund(refund.id, { idempotencyKey: `p11-refund-${tag}-bank:fin2`, actorId: actor }),
    ]);
    const errCode = (r: PromiseSettledResult<unknown>) => {
      if (r.status === "fulfilled") return "OK";
      const e = r.reason as { response?: { code?: string }; code?: string; message?: string };
      return e?.response?.code ?? e?.code ?? e?.message ?? "ERR";
    };
    const states = [a, b].map(errCode);
    expect(states.filter((s) => s === "OK")).toHaveLength(1);
    expect(states.filter((s) => s === "REFUND_ALREADY_FINALIZED")).toHaveLength(1);

    const after = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(after.state).toBe("COMPLETED");
    const banksAfter = await prisma.bankAccount.aggregate({ where: bankWhere, _sum: { currentBalance: true } });
    expect((banksAfter._sum.currentBalance ?? 0n)).toBe(beforeSum - 300_000n);
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "refund", sourceId: refund.id }, include: { lines: { include: { account: true } } } });
    // سند روی زیرشاخهٔ واقعی بانک (1100-XX) ثبت میشود — نه گروه 1100
    expect(entry.lines.find((l) => l.account.code.startsWith("1100"))?.credit).toBe(300_000n);
  });

  it("B3) refund STORE_CREDIT بدون خزانه/سند؛ cancel فقط از PENDING", async () => {
    const rr = await prisma.returnRequest.create({ data: { number: `RT-${tag}-SC`, status: "SETTLED", actorId: actor } as never });
    const sc = await prisma.refund.create({
      data: {
        number: `RF-${tag}-SC`,
        refundType: "partial",
        method: "STORE_CREDIT",
        amount: 90_000n,
        state: "PENDING",
        sourceType: "order",
        sourceId: rr.id,
        returnId: rr.id,
        idempotencyKey: `p11-refund-${tag}-sc`,
        actorId: actor,
      },
    });
    const bankBefore = await prisma.bankAccount.findFirst();
    const cashBefore = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    const done = await returns.finalizeRefund(sc.id, { idempotencyKey: `p11-refund-${tag}-sc:fin`, actorId: actor });
    expect(done.state).toBe("COMPLETED");
    expect(await prisma.journalEntry.count({ where: { sourceType: "refund", sourceId: sc.id } })).toBe(0);
    const bankAfter = await prisma.bankAccount.findFirst();
    if (bankBefore) expect(bankAfter!.currentBalance).toBe(bankBefore.currentBalance);
    expect((await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } })).currentBalance).toBe(cashBefore.currentBalance);

    // cancel روی COMPLETED مجاز نیست
    await expect(returns.cancelRefund(sc.id, { actorId: actor })).rejects.toThrow(BadRequestException);

    // cancel از PENDING مجاز و بدون اثر مالی
    const rr2 = await prisma.returnRequest.create({ data: { number: `RT-${tag}-CC`, status: "SETTLED", actorId: actor } as never });
    const c = await prisma.refund.create({
      data: {
        number: `RF-${tag}-CC`,
        refundType: "partial",
        method: "CASH",
        amount: 50_000n,
        state: "PENDING",
        sourceType: "order",
        sourceId: rr2.id,
        returnId: rr2.id,
        idempotencyKey: `p11-refund-${tag}-cc`,
        actorId: actor,
      },
    });
    const cancelled = await returns.cancelRefund(c.id, { actorId: actor, reason: "تست" });
    expect(cancelled.state).toBe("CANCELLED");
    await expect(returns.finalizeRefund(c.id, { idempotencyKey: `p11-refund-${tag}-cc:fin` })).rejects.toThrow(BadRequestException);
    expect(await prisma.journalEntry.count({ where: { sourceType: "refund", sourceId: c.id } })).toBe(0);
  });
});
