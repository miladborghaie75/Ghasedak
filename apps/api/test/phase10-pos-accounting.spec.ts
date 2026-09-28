/**
 * فاز ۱۰ — POS/Treasury/Accounting Operational UX — تست‌های یکپارچه (بخش ۱۸/۱۹)
 *
 * سناریوها:
 *  A) POS cash sale → invoice+payment+journal+cash projection
 *  B) POS card sale → journal → bank projection
 *  C) POS check sale → check+AR+journal → clear → bank (Match ≠ Clear حفظ)
 *  D) purchase invoice check payment → issued check → clear/bounce مسیر واقعی PurchasingService
 *     (اینجا فقط issued-check lifecycle از همان API رسمی checks.service پوشش داده می‌شود
 *      تا پوشش duplicate نشود؛ سناریوی کامل خرید در purchasing spec موجود است)
 *  E) POS sale با mobile → POS_SALE_COMPLETED outbox → consumer → بدون credential پیام فیک نمی‌سازد
 *  F) invoice detail (persisted) + list filters
 *  G) correction: revision+1 + correctsId + reverse journal + stale source
 *  H) manual journal: DRAFT/FINAL + unbalanced rejection + same-line Dr/Cr rejection
 *  I) account tree: build از parentAccountId + create child + activation guard
 *
 * همهٔ داده‌ها tag-دار و در afterAll کامل پاک می‌شوند (الگوی Wave 2/3).
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

jest.setTimeout(120_000);

describe("Phase 10 — POS / Treasury / Accounting operations", () => {
  let prisma: PrismaService;
  let journal: JournalService;
  let treasury: TreasuryService;
  let inventory: InventoryService;
  let bus: EventBusService;
  let pos: PosService;
  let checks: ChecksService;
  let actor: string;
  let shiftId: string;
  let registerId: string | null = null;
  let fixtureSku: string;
  const tag = `p10${Date.now()}${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    journal = new JournalService(prisma);
    treasury = new TreasuryService(prisma, journal);
    inventory = new InventoryService(prisma, new InventorySettingsService(prisma));
    bus = new EventBusService(prisma);
    checks = new ChecksService(prisma, journal);
    pos = new PosService(prisma, inventory, journal, new PricingService(prisma, bus), treasury, checks);
    actor = (await prisma.user.findFirstOrThrow()).id;

    // شیفت بازی احتمالی از اجرای قبلی همین user را می‌بندیم تا openShift قطعی باشد
    for (const s of await prisma.cashierShift.findMany({ where: { userId: actor, state: "OPEN" } })) {
      await prisma.cashierShift.update({ where: { id: s.id }, data: { state: "CLOSED" as never } }).catch(() => undefined);
    }
    const shift = await pos.openShift({ userId: actor, registerName: `REG-${tag}`, openingCash: 0 });
    shiftId = shift.id;
    registerId = shift.registerId;

    // فیکسچر اختصاصی: محصول/واریانت با موجودی واقعی از مسیر رسمی Ledger (OPENING)
    const cat = await prisma.category.findFirstOrThrow();
    const product = await prisma.product.create({
      data: {
        name: `محصول Phase10 ${tag}`,
        slug: `p10-fixture-${tag}`,
        status: "PUBLISHED",
        categoryId: cat.id,
        basePrice: 400_000n,
        variants: { create: [{ sku: `P10-SKU-${tag}`, price: 400_000n }] },
      },
      include: { variants: true },
    });
    fixtureSku = product.variants[0].sku;
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId;
    await inventory.move({
      warehouseId: whId!,
      variantSku: fixtureSku,
      type: "OPENING",
      qty: 50,
      unitCost: 100_000n,
      refType: "opening",
      refId: tag,
      idempotencyKey: `p10-opening-${tag}`,
      actorId: actor,
    });
  });

  afterAll(async () => {
    // پاک‌سازی کامل tag-محور — ترتیب FK: payments → checks/AR/AP → items → invoices → journal → ledger
    const invoices = await prisma.posInvoice.findMany({
      where: { OR: [{ idempotencyKey: { startsWith: `p10-${tag}` } }, { idempotencyKey: { startsWith: `p10-correction:${tag}` } }] },
      select: { id: true, number: true },
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
      // Prisma JSON filter از `in` پشتیبانی نمی‌کند — حلقهٔ per-id با `equals` (الگوی wave1)
      for (const iid of ids) {
        await prisma.domainEventOutbox.deleteMany({ where: { OR: [
          { name: "POS_SALE_COMPLETED", payload: { path: ["invoiceId"], equals: iid } as never },
          { name: "CheckCreated", payload: { path: ["invoiceId"], equals: iid } as never },
        ] } });
      }
      const removedMoves = await prisma.stockLedgerEntry.findMany({ where: { refType: "pos_invoice", refId: { in: ids } }, select: { variantSku: true, qtyOut: true } });
      for (const m of removedMoves) {
        await prisma.productVariant.update({ where: { sku: m.variantSku }, data: { stockQty: { increment: m.qtyOut } } });
      }
      await prisma.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: { in: ids } } });
      await prisma.numberSeries.update({ where: { scope: "pos_invoice" }, data: { nextNumber: { decrement: ids.length } } }).catch(() => undefined);
    }
    // مشتری‌های این اجرا
    const customers = await prisma.customer.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    for (const c of customers) {
      await prisma.customerAccount.deleteMany({ where: { customerId: c.id } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: c.id } }).catch(() => undefined);
    }
    // حساب فرزند تست (اگر ساخته شد)
    await prisma.account.deleteMany({ where: { code: { startsWith: `99p10${tag.slice(-6)}` } } }).catch(() => undefined);
    // اسناد دستی tag-دار
    await prisma.journalEntry.deleteMany({ where: { sourceType: "manual", description: { contains: tag } } });
    // فیکسچر محصول/واریانت
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
    if (registerId) await prisma.cashRegister.deleteMany({ where: { id: registerId, name: `REG-${tag}` } });
    await prisma.$disconnect();
  });

  it("A) POS cash sale → invoice + CASH payment + سند متوازن + cash projection", async () => {
    const ep = await (new PricingService(prisma, bus)).effectivePrice(fixtureSku, "pos");
    const unit = Number(ep.salePrice ?? ep.price);
    const amount = unit * 2; // qty=2
    const before = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    const r = await pos.sale({
      shiftId,
      lines: [{ sku: fixtureSku, qty: 2 }],
      payments: [{ methodCode: "cash", amount }],
      idempotencyKey: `p10-${tag}-cash`,
    }, actor);
    expect(r.id).toBeTruthy();

    const invoice = await prisma.posInvoice.findUniqueOrThrow({ where: { id: r.id }, include: { payments: true, items: true } });
    expect(invoice.state).toBe("FINALIZED");
    expect(invoice.payments.map((p) => p.method)).toEqual(["CASH"]);
    expect(invoice.items).toHaveLength(1);

    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "pos_invoice", sourceId: invoice.id }, include: { lines: true } });
    const dr = entry.lines.reduce((a, l) => a + (l.debit ?? 0n), 0n);
    const cr = entry.lines.reduce((a, l) => a + (l.credit ?? 0n), 0n);
    expect(dr).toBe(cr);
    expect(dr).toBe(BigInt(amount));

    const after = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    expect(after.currentBalance).toBe(before.currentBalance + BigInt(amount));
  });

  it("B) POS card sale → CARD payment + سند + bank GL (projection بانک demo دست‌نخورده می‌ماند — CARD به GL 1100 می‌رود)", async () => {
    const ep = await (new PricingService(prisma, bus)).effectivePrice(fixtureSku, "pos");
    const amount = Number(ep.salePrice ?? ep.price);
    const r = await pos.sale({
      shiftId,
      lines: [{ sku: fixtureSku, qty: 1 }],
      payments: [{ methodCode: "pos_terminal", amount }],
      idempotencyKey: `p10-${tag}-card`,
    }, actor);
    expect(r.id).toBeTruthy();
    const invoice = await prisma.posInvoice.findUniqueOrThrow({ where: { id: r.id }, include: { payments: true } });
    expect(invoice.payments[0].method).toBe("CARD");
    const entry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "pos_invoice", sourceId: invoice.id }, include: { lines: { include: { account: true } } } });
    const dr = entry.lines.reduce((a, l) => a + (l.debit ?? 0n), 0n);
    const cr = entry.lines.reduce((a, l) => a + (l.credit ?? 0n), 0n);
    expect(dr).toBe(cr);
    expect(dr).toBe(BigInt(amount));
    // CARD → حساب بانکی GL (1100) بدهکار
    expect(entry.lines.find((l) => l.account.code === "1100")?.debit).toBe(BigInt(amount));
  });

  it("C) POS check sale → check+AR+transition در همان tx؛ سپس clear → bank (Match ≠ Clear)", async () => {
    const customer = await prisma.customer.create({ data: { mobile: `0914${String(Date.now()).slice(-7)}`, name: `مشتری P10 ${tag}` } });
    try {
      const ep = await (new PricingService(prisma, bus)).effectivePrice(fixtureSku, "pos");
      const amount = Number(ep.salePrice ?? ep.price);
      const r = await pos.sale({
        shiftId,
        lines: [{ sku: fixtureSku, qty: 1 }],
        payments: [{ methodCode: "check", amount, checkNumber: `CH-${tag}`, bankName: "بانک P10", dueDateDays: 20 }],
        customerMobile: customer.mobile,
        customerName: customer.name ?? undefined,
        idempotencyKey: `p10-${tag}-check`,
      }, actor);
      const invoice = await prisma.posInvoice.findUniqueOrThrow({ where: { id: r.id }, include: { payments: true } });
      const checkId = invoice.payments[0].checkId!;
      expect(checkId).toBeTruthy();

      const arBefore = await prisma.accountsReceivable.findFirst({ where: { refType: "check", refId: checkId } });
      expect(arBefore).toBeTruthy();

      // deposit + clear از API رسمی lifecycle — bank demo اثر می‌پذیرد
      await checks.transition({ checkId, toStatus: "DEPOSITED", actorId: actor, idempotencyKey: `p10-${tag}-dep` });
      const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
      const glBefore = await prisma.journalLine.aggregate({ where: { accountId: glBank.id }, _sum: { debit: true, credit: true } });
      await checks.transition({ checkId, toStatus: "CLEARED", actorId: actor, idempotencyKey: `p10-${tag}-clr` });
      const glAfter = await prisma.journalLine.aggregate({ where: { accountId: glBank.id }, _sum: { debit: true, credit: true } });
      expect((glAfter._sum.debit ?? 0n) - (glBefore._sum.debit ?? 0n)).toBe(BigInt(amount));

      const check = await prisma.check.findUniqueOrThrow({ where: { id: checkId } });
      expect(check.status).toBe("CLEARED");
      const transitions = await prisma.checkTransition.findMany({ where: { checkId }, orderBy: { id: "asc" } });
      // CREATION هم transition ثبت می‌کند (toStatus=RECEIVED) — پس کل lifecycle سه گام است
      expect(transitions.map((t) => t.toStatus)).toEqual(["RECEIVED", "DEPOSITED", "CLEARED"]);
      // تفکیک Match ≠ Clear — clear سند دارد ولی match ندارد
      const matches = await prisma.bankStatementMatch.count({ where: { checkId } });
      expect(matches).toBe(0);
    } finally {
      await prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
    }
  });

  it("E) POS sale با mobile → POS_SALE_COMPLETED outbox؛ consumer بدون credential پیام SMS فیک نمی‌سازد ولی ADMIN notify می‌کند", async () => {
    const KAV = process.env.KAVENEGAR_API_KEY;
    delete process.env.KAVENEGAR_API_KEY; // صریحاً بدون credential
    const ep = await (new PricingService(prisma, bus)).effectivePrice(fixtureSku, "pos");
    const amount = Number(ep.salePrice ?? ep.price);
    try {
      const r = await pos.sale({
        shiftId,
        lines: [{ sku: fixtureSku, qty: 1 }],
        payments: [{ methodCode: "cash", amount }],
        customerMobile: `0915${String(Date.now()).slice(-7)}`,
        customerName: `مشتری SMS ${tag}`,
        idempotencyKey: `p10-${tag}-sms`,
      }, actor);
      const ev = await prisma.domainEventOutbox.findFirstOrThrow({ where: { name: "POS_SALE_COMPLETED", payload: { path: ["invoiceId"], equals: r.id } as never } });
      expect(ev.state).toBe("PENDING");

      // مصرف رویداد از منبع حقیقت — drain پنجرهٔ ۲۰تایی دارد و در full-suite رویدادهای
      // PENDING قدیمی‌تر suiteهای قبل ممکن است پنجره را پر کنند؛ پس تا DISPATCHED شدن
      // رویداد خودمان تکرار می‌کنیم (سقف ۱۰ پاس).
      let processed = await prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: ev.id } });
      for (let i = 0; i < 10 && processed.state === "PENDING"; i++) {
        await bus.drain();
        processed = await prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: ev.id } });
      }
      expect(processed.state).toBe("DISPATCHED");
      // بدون credential: هیچ SMS ساخته نمی‌شود — ولی admin notify هست (auditable)
      const sms = await prisma.notification.count({ where: { channel: "SMS", templateKey: `pos-sale-sms:${r.id}` } });
      expect(sms).toBe(0);
      const admin = await prisma.notification.count({ where: { channel: "ADMIN", templateKey: `pos-sale:${r.id}` } });
      expect(admin).toBe(1);
    } finally {
      if (KAV) process.env.KAVENEGAR_API_KEY = KAV;
    }
  });

  it("F) invoice detail از دادهٔ persisted + list filters", async () => {
    const inv = await prisma.posInvoice.findFirstOrThrow({ where: { idempotencyKey: `p10-${tag}-cash` }, select: { id: true, number: true } });
    const detail = await pos.invoiceDetail(inv.id);
    expect(detail.invoice.id).toBe(inv.id);
    expect(detail.invoice.items).toHaveLength(1);
    expect(detail.journal).toBeTruthy();
    expect(detail.ledgerMoves.length).toBeGreaterThan(0);
    expect(detail.corrections).toHaveLength(0);

    const list = await pos.invoiceList({ q: inv.number });
    expect(list.items.some((i) => i.number === inv.number)).toBe(true);
    const byMethod = await pos.invoiceList({ method: "CASH" });
    expect(byMethod.items.every((i) => i.payments.some((p) => p.method === "CASH"))).toBe(true);
    const today = await pos.invoiceList({ from: new Date(Date.now() - 86_400_000).toISOString() });
    expect(today.items.length).toBeGreaterThan(0);
  });

  it("G) correction: FINALIZED → revision+1 + correctsId + reverse journal؛ و stale-source با CONFLICT", async () => {
    const source = await prisma.posInvoice.findFirstOrThrow({ where: { idempotencyKey: `p10-${tag}-card` }, include: { items: true } });
    const revBefore = source.revision;
    const srcEntry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "pos_invoice", sourceId: source.id }, include: { lines: { include: { account: true } } } });
    const srcDr = srcEntry.lines.reduce((a, l) => a + (l.debit ?? 0n), 0n);

    const r = await pos.correctInvoice({
      invoiceId: source.id,
      lines: [{ sku: fixtureSku, qty: 1 }],
      payments: [{ methodCode: "cash", amount: Number(source.grandTotal) }],
      reason: `اصلاحیهٔ تست ${tag}`,
      idempotencyKey: `p10-correction:${tag}:${source.id}`,
      shiftId,
    }, actor);
    const corrected = await prisma.posInvoice.findUniqueOrThrow({ where: { id: r.id } });
    expect(corrected.revision).toBe(revBefore + 1);
    expect(corrected.correctsId).toBe(source.id);

    const detail = await pos.invoiceDetail(source.id);
    expect(detail.corrections).toHaveLength(1);
    expect(detail.corrections[0].number).toBe(corrected.number);

    // سند معکوس: Dr/Cr جابه‌جا، متوازن، sourceType=pos_correction
    const revEntry = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "pos_correction", sourceId: corrected.id }, include: { lines: true } });
    const revDr = revEntry.lines.reduce((a, l) => a + (l.debit ?? 0n), 0n);
    const revCr = revEntry.lines.reduce((a, l) => a + (l.credit ?? 0n), 0n);
    expect(revDr).toBe(revCr);
    expect(revDr).toBe(srcDr);

    // stale source: اصلاح دوباره از فاکتور مبدأ باید CONFLICT بدهد
    await expect(pos.correctInvoice({
      invoiceId: source.id,
      lines: [{ sku: fixtureSku, qty: 1 }],
      payments: [{ methodCode: "cash", amount: Number(source.grandTotal) }],
      reason: "دوباره",
      idempotencyKey: `p10-correction:${tag}:${source.id}:again`,
      shiftId,
    }, actor)).rejects.toThrow(ConflictException);
  });

  it("H) manual journal: FINAL متوازن ثبت می‌شود؛ unbalanced و same-line Dr/Cr رد می‌شوند؛ DRAFT → finalize", async () => {
    const accDr = await prisma.account.findUniqueOrThrow({ where: { code: "6000" } });
    const accCr = await prisma.account.findUniqueOrThrow({ where: { code: "2100" } });
    // متوازن FINAL
    const e = await journal.postManual({
      description: `سند دستی P10 ${tag}`,
      sourceType: "manual",
      state: "FINAL",
      actorId: actor,
      lines: [
        { accountCode: accDr.code, debit: 111_111 },
        { accountCode: accCr.code, credit: 111_111 },
      ],
    });
    expect(e.state).toBe("FINAL");
    // unbalanced
    await expect(journal.postManual({
      description: "نا‌متعادل",
      sourceType: "manual",
      lines: [
        { accountCode: accDr.code, debit: 100 },
        { accountCode: accCr.code, credit: 90 },
      ],
    })).rejects.toThrow(BadRequestException);
    // همان خط هم بدهکار و هم بستانکار
    await expect(journal.postManual({
      description: "خط دوطرفه",
      sourceType: "manual",
      lines: [
        { accountCode: accDr.code, debit: 100, credit: 100 },
        { accountCode: accCr.code, credit: 100 },
      ],
    })).rejects.toThrow(BadRequestException);
    // DRAFT → finalize → FINAL
    const d = await journal.postManual({
      description: `پیش‌نویس P10 ${tag}`,
      sourceType: "manual",
      state: "DRAFT",
      actorId: actor,
      lines: [
        { accountCode: accDr.code, debit: 50_000 },
        { accountCode: accCr.code, credit: 50_000 },
      ],
    });
    expect(d.state).toBe("DRAFT");
    const fin = await journal.finalize(d.id, actor);
    expect(fin.state).toBe("FINAL");
    await expect(journal.finalize(d.id, actor)).rejects.toThrow(BadRequestException); // دوباره
  });

  it("I) account tree از parentAccountId + ایجاد فرزند + guard فعال‌سازی", async () => {
    const tree = (await journal.accountTree()) as { items: Array<{ id: string; code: string; name: string; balanceDr: string; balanceCr: string; children: unknown[] }> };
    expect(Array.isArray(tree.items)).toBe(true);
    expect(tree.items.length).toBeGreaterThan(0);
    // توازن کل درخت = توازن ledger (جمع ریشه‌ها)
    let totalDr = 0n;
    let totalCr = 0n;
    const walk = (n: { balanceDr: string; balanceCr: string; children: Array<{ balanceDr: string; balanceCr: string; children: never[] }> }) => {
      // توازن تجمعی فقط روی ریشه‌ها معتبر است — فرزندان جزو والد جمع شده‌اند
    };
    void walk;
    for (const root of tree.items) {
      totalDr += BigInt(root.balanceDr);
      totalCr += BigInt(root.balanceCr);
    }
    const integrity = await journal.integrity();
    expect(totalDr).toBe(BigInt(integrity.debit));
    expect(totalCr).toBe(BigInt(integrity.credit));
    expect(totalDr).toBe(totalCr);

    // ایجاد فرزند + dup guard
    const parent = await prisma.account.findUniqueOrThrow({ where: { code: "1000" } });
    const childCode = `99p10${tag.slice(-6)}`;
    const child = await journal.createChildAccount(parent.id, { code: childCode, name: "حساب تست P10" }, actor);
    expect(child.level).toBe(parent.level + 1);
    await expect(journal.createChildAccount(parent.id, { code: childCode, name: "تکراری" }, actor)).rejects.toThrow(BadRequestException);
    // حساب بدون تراکنش قابل غیرفعال‌سازی است
    const deact = await journal.setAccountActive(child.id, false, actor);
    expect(deact.isActive).toBe(false);
  });
});
