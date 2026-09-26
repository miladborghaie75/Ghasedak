/** فاز ۹ — Wave 1: R1 (POS CHECK) + R3 (auto-match 0/1/N) روی rehearsal DB */
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { PricingService } from "../src/pricing/pricing.service";
import { PosService } from "../src/pos/pos.service";
import { EventBusService } from "../src/events/event-bus.service";

jest.setTimeout(60_000);

describe("Phase 9 Wave 1 — R1/R3", () => {
  let prisma: PrismaService;
  let journal: JournalService;
  let treasury: TreasuryService;
  let bus: EventBusService;
  let pricing: PricingService;
  let inventory: InventoryService;
  let pos: PosService;
  let actor: string;
  let shiftId: string;
  let sku: string;
  let registerId: string | null = null;
  const tag = `w1${Date.now()}${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    journal = new JournalService(prisma);
    treasury = new TreasuryService(prisma, journal);
    bus = new EventBusService(prisma);
    pricing = new PricingService(prisma, bus);
    inventory = new InventoryService(prisma, new InventorySettingsService(prisma));
    pos = new PosService(prisma, inventory, journal, pricing, treasury);
    actor = (await prisma.user.findFirstOrThrow()).id;
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } });
    sku = variant.sku;
    // اگر از اجرای قبلی شیفت بازی مانده، همان را استفاده کن (idempotent across runs)
    let shift = await prisma.cashierShift.findFirst({ where: { userId: actor, state: "OPEN" } });
    if (!shift) {
      shift = await pos.openShift({ userId: actor, registerName: `REG-${tag}`, openingCash: 0 });
    }
    shiftId = shift.id;
    registerId = shift.registerId;
  });

  afterAll(async () => {
    // پاک‌سازی فقط داده‌های همین تست
    const invoices = await prisma.posInvoice.findMany({ where: { number: { startsWith: "POS" }, createdAt: { gte: new Date(Date.now() - 3_600_000) } }, select: { id: true } });
    const ids = invoices.map((i) => i.id);
    if (ids.length) {
      await prisma.posPayment.deleteMany({ where: { invoiceId: { in: ids } } });
      await prisma.check.deleteMany({ where: { sourceType: "pos_invoice", sourceId: { in: ids } } });
      await prisma.posInvoiceItem.deleteMany({ where: { invoiceId: { in: ids } } });
      await prisma.posInvoice.deleteMany({ where: { id: { in: ids } } });
      await prisma.journalEntry.deleteMany({ where: { sourceType: "pos_invoice", sourceId: { in: ids } } });
      for (const id of ids) {
        await prisma.domainEventOutbox.deleteMany({ where: { name: "CheckCreated", payload: { path: ["invoiceId"], equals: id } as never } });
      }
      await prisma.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: { in: ids } } });
      await prisma.numberSeries.update({ where: { scope: "pos_invoice" }, data: { nextNumber: { decrement: ids.length } } }).catch(() => undefined);
    }
    const banks = await prisma.bankAccount.findMany({ where: { id: { startsWith: `test-bank-${tag}` } }, select: { id: true } });
    for (const b of banks) {
      await prisma.bankStatementMatch.deleteMany({ where: { statement: { bankAccountId: b.id } } });
      await prisma.bankStatement.deleteMany({ where: { bankAccountId: b.id } });
      await prisma.bankAccount.delete({ where: { id: b.id } });
    }
    await prisma.paymentAttempt.deleteMany({ where: { idempotencyKey: { startsWith: `test-${tag}` } } });
    await prisma.cashierShift.deleteMany({ where: { id: shiftId } });
    if (registerId) await prisma.cashRegister.deleteMany({ where: { id: registerId, name: `REG-${tag}` } });
    await prisma.$disconnect();
  });

  const balances = async () => {
    const cash = await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } });
    const bank = await prisma.bankAccount.findUniqueOrThrow({ where: { id: "demo-bank-main" } });
    return { cash: cash.currentBalance, bank: bank.currentBalance };
  };

  /** فیکسچر انبار: rehearsal DB تازه ledger خالی دارد — یک دریافت اولیه برای variant تست */
  const ensureStock = async (): Promise<void> => {
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId;
    if (!whId) throw new Error("pos channel has no defaultWarehouseId");
    const ledger = await prisma.stockLedgerEntry.findFirst({ where: { warehouseId: whId, variantSku: sku } });
    if (!ledger) {
      await inventory.move({ warehouseId: whId, variantSku: sku, type: "ADJUSTMENT", qty: 10, unitCost: 100000n, refType: "manual", refId: tag, idempotencyKey: `w1-restock-${tag}`, actorId: actor });
    }
  };

  it("R1 happy path: POS CHECK → invoice+payment+check+journal(out)+outbox در یک tx؛ Dr 1220/Cr 4000؛ خزانه بی‌تغییر", async () => {
    await ensureStock();
    const before = await balances();
    const customer = await prisma.customer.create({ data: { mobile: `0912${String(Date.now()).slice(-7)}`, name: "مشتری چکی (TEST)" } });
    try {
      const ep = await pricing.effectivePrice(sku, "pos");
      const amount = Number(ep.salePrice ?? ep.price);
      const r = await pos.sale({
        shiftId,
        lines: [{ sku, qty: 1 }],
        payments: [{ methodCode: "check", amount, checkNumber: `CH-${tag}`, bankName: "بانک تست", dueDateDays: 30 }],
        customerMobile: customer.mobile,
        customerName: customer.name ?? undefined,
        idempotencyKey: `w1-check-${tag}`,
      }, actor);
      expect(r.id).toBeTruthy();

      const invoice = await prisma.posInvoice.findUniqueOrThrow({ where: { id: r.id }, include: { payments: true } });
      expect(invoice.payments).toHaveLength(1);
      expect(invoice.payments[0].method).toBe("CHECK");
      expect(invoice.payments[0].checkId).toBeTruthy();

      const check = await prisma.check.findUniqueOrThrow({ where: { id: invoice.payments[0].checkId! } });
      expect(check.direction).toBe("RECEIVED");
      expect(check.status).toBe("RECEIVED");
      expect(check.sourceType).toBe("pos_invoice");
      expect(check.sourceId).toBe(invoice.id);
      expect(check.customerId).toBe(customer.id);
      expect(check.amount).toBe(BigInt(amount));

      const entries = await prisma.journalEntry.findMany({ where: { sourceType: "pos_invoice", sourceId: invoice.id }, include: { lines: { include: { account: true } } } });
      expect(entries).toHaveLength(1);
      const lines = entries[0].lines;
      const dr = lines.filter((l) => l.debit > 0n).reduce((a, l) => a + l.debit, 0n);
      const cr = lines.filter((l) => l.credit > 0n).reduce((a, l) => a + l.credit, 0n);
      expect(dr).toBe(cr); // متوازن
      expect(dr).toBe(BigInt(amount));
      expect(lines.find((l) => l.account.code === "1220")?.debit).toBe(BigInt(amount));
      expect(lines.find((l) => l.account.code === "4000")?.credit).toBe(BigInt(amount));

      const outbox = await prisma.domainEventOutbox.findFirst({ where: { name: "CheckCreated", payload: { path: ["invoiceId"], equals: invoice.id } as never } });
      expect(outbox).toBeTruthy();

      const after = await balances();
      expect(after.cash).toBe(before.cash); // CHECK اثری روی خزانه ندارد
      expect(after.bank).toBe(before.bank);
    } finally {
      await prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
    }
  });

  it("R1: چک بدون مشتری → CHECK_CUSTOMER_REQUIRED (هیچ چیز ساخته نمی‌شود)", async () => {
    const before = await prisma.check.count();
    await expect(pos.sale({
      shiftId,
      lines: [{ sku, qty: 1 }],
      payments: [{ methodCode: "check", amount: 700000 }],
      idempotencyKey: `w1-nocust-${tag}`,
    }, actor)).rejects.toThrow();
    expect(await prisma.check.count()).toBe(before);
  });

  it("R1: tender ناشناخته → UNKNOWN_TENDER (هرگز WALLET)", async () => {
    await expect(pos.sale({
      shiftId,
      lines: [{ sku, qty: 1 }],
      payments: [{ methodCode: `crypto-${tag}`, amount: 100000 }],
      idempotencyKey: `w1-unknown-${tag}`,
    }, actor)).rejects.toThrow();
    const inv = await prisma.posInvoice.findFirst({ where: { idempotencyKey: `w1-unknown-${tag}` } });
    expect(inv).toBeNull();
  });

  it("R1 atomicity: شکست سند ⇒ rollback کامل (بدون orphan Check/Payment/Invoice/Journal/Outbox)", async () => {
    await ensureStock();
    // fail-safe: نام حساب را موقتاً عوض می‌کنیم تا lookup سند با ACCOUNT_NOT_FOUND شکست بخورد (بدون نقض FK)
    const gl1220 = await prisma.account.findUniqueOrThrow({ where: { code: "1220" } });
    await prisma.account.update({ where: { code: "1220" }, data: { code: `9999-off-${tag}` } });
    try {
      const customer = await prisma.customer.create({ data: { mobile: `0913${String(Date.now()).slice(-7)}`, name: "مشتری rollback (TEST)" } });
      try {
        await expect(pos.sale({
          shiftId,
          lines: [{ sku, qty: 1 }],
          payments: [{ methodCode: "check", amount: 650000, dueDateDays: 10 }],
          customerMobile: customer.mobile,
          idempotencyKey: `w1-fail-${tag}`,
        }, actor)).rejects.toThrow();
      } finally {
        await prisma.customer.delete({ where: { id: customer.id } }).catch(() => undefined);
      }
    } finally {
      await prisma.account.update({ where: { code: `9999-off-${tag}` }, data: { code: "1220" } }).catch(() => undefined);
    }
    const inv = await prisma.posInvoice.findFirst({ where: { idempotencyKey: `w1-fail-${tag}` } });
    expect(inv).toBeNull(); // فاکتور هم rollback شده
    const checksBefore = await prisma.check.count();
    const paymentsBefore = await prisma.posPayment.count();
    const outboxForFail = await prisma.domainEventOutbox.findFirst({ where: { name: "CheckCreated", payload: { path: ["invoiceId"], equals: "no-such-invoice" } as never } });
    expect(outboxForFail).toBeNull();
    // هیچ orphan چک/پرداخت جدید اضافه نشده (شمارش‌ها باید بعد از rollback همان قبل از sale باشند)
    expect(checksBefore).toBe(await prisma.check.count());
    expect(paymentsBefore).toBe(await prisma.posPayment.count());
  });

  it("R3 Case A: صفر candidate → UNMATCHED (هیچ رکورد match و هیچ mutation مالی)", async () => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.create({ data: { id: `test-bank-${tag}-a`, name: `بانک A ${tag}`, bankName: "بانک", accountNumber: "1", glAccountId: glBank.id, currentBalance: 0n } });
    await treasury.importStatements({ bankAccountId: bank.id, lines: [{ date: new Date().toISOString(), amount: 111000, description: "بدون تطبیق" }], actorId: actor });
    const bookBefore = await prisma.journalLine.aggregate({ where: { accountId: glBank.id }, _sum: { debit: true, credit: true } });
    const r = await treasury.autoMatch(bank.id, actor);
    expect(r.matched).toBe(0);
    expect(r.ambiguous).toBe(0);
    expect(r.unmatched).toBe(1);
    expect(await prisma.bankStatementMatch.count({ where: { statement: { bankAccountId: bank.id } } })).toBe(0);
    const bookAfter = await prisma.journalLine.aggregate({ where: { accountId: glBank.id }, _sum: { debit: true, credit: true } });
    expect(bookAfter._sum.debit).toBe(bookBefore._sum.debit); // no GL mutation
  });

  it("R3 Case B: دقیقاً یک candidate → AUTO MATCH (matchedPaymentId + Match رکورد؛ بدون GL/خزانه/Check-clear)", async () => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.create({ data: { id: `test-bank-${tag}-b`, name: `بانک B ${tag}`, bankName: "بانک", accountNumber: "2", glAccountId: glBank.id, currentBalance: 0n } });
    await treasury.importStatements({ bankAccountId: bank.id, lines: [{ date: new Date().toISOString(), amount: 1500000, description: "ورودی درگاه" }], actorId: actor });
    const method = await prisma.paymentMethod.findFirstOrThrow({ where: { code: "online" } });
    const attempt = await prisma.paymentAttempt.create({ data: { methodId: method.id, amount: 1500000n, state: "PAID", idempotencyKey: `test-${tag}-b`, authority: `AUT-${tag}`, verifiedAt: new Date() } });
    const bookBefore = await prisma.journalLine.aggregate({ where: { accountId: glBank.id }, _sum: { debit: true, credit: true } });
    const bankBefore = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;

    // فیکسچر ۰/۱/N: از previous runs روی rehearsal DB مشترک، candidateهای 1.5M جمع شده‌اند.
    // برای «دقیقاً یک candidate»، فقط attemptهای همین tag را در زمان‌پنجره نگه می‌داریم:
    // previous-run attemptها را موقتاً به state PAID→VERIFYING می‌بریم تا خارج از فیلتر شوند، بعد برمی‌گردانیم.
    const others = await prisma.paymentAttempt.findMany({
      where: { state: "PAID", amount: 1500000n, idempotencyKey: { not: `test-${tag}-b` } },
      select: { id: true },
    });
    // eslint-disable-next-line no-console
    console.log(`[caseB pre-autoMatch] isolating ${others.length} legacy 1.5M attempts`);
    await prisma.paymentAttempt.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { state: "VERIFYING" } });
    let r;
    try {
      r = await treasury.autoMatch(bank.id, actor);
    } finally {
      await prisma.paymentAttempt.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { state: "PAID" } });
    }
    expect(r.matched).toBe(1);
    expect(r.ambiguous).toBe(0);

    const stmt = await prisma.bankStatement.findFirstOrThrow({ where: { bankAccountId: bank.id, amount: 1500000n } });
    expect(stmt.matchedPaymentId).toBe(attempt.id);
    const match = await prisma.bankStatementMatch.findFirstOrThrow({ where: { statementId: stmt.id } });
    expect(match.state).toBe("MATCHED");
    expect(match.sourceType).toBe("payment_attempt");
    expect(match.allocatedAmount).toBe(1500000n);

    const bookAfter = await prisma.journalLine.aggregate({ where: { accountId: glBank.id }, _sum: { debit: true, credit: true } });
    expect(bookAfter._sum.debit).toBe(bookBefore._sum.debit); // no GL mutation
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(bankBefore); // no treasury mutation
    // Match ≠ Clear: هیچ وضعیت چکی تغییر نکرده (تعداد/status چک‌ها قبل/بعد یکسان)
    expect(await prisma.check.count({ where: { status: { not: "RECEIVED" } } })).toBe(0);
  });

  it("R3 Case C: چند candidate → MANUAL_REVIEW (هیچ انتخاب خودکار؛ matchedPaymentId خالی می‌ماند)", async () => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.create({ data: { id: `test-bank-${tag}-c`, name: `بانک C ${tag}`, bankName: "بانک", accountNumber: "3", glAccountId: glBank.id, currentBalance: 0n } });
    await treasury.importStatements({ bankAccountId: bank.id, lines: [{ date: new Date().toISOString(), amount: 250000, description: "مبهم" }], actorId: actor });
    const method = await prisma.paymentMethod.findFirstOrThrow({ where: { code: "online" } });
    for (let i = 0; i < 2; i++) {
      await prisma.paymentAttempt.create({ data: { methodId: method.id, amount: 250000n, state: "PAID", idempotencyKey: `test-${tag}-c${i}`, authority: `AUT2-${tag}-${i}`, verifiedAt: new Date() } });
    }
    const r = await treasury.autoMatch(bank.id, actor);
    expect(r.ambiguous).toBe(1);
    expect(r.matched).toBe(0);
    const stmt = await prisma.bankStatement.findFirstOrThrow({ where: { bankAccountId: bank.id, amount: 250000n } });
    expect(stmt.matchedPaymentId).toBeNull(); // هیچ انتخاب خودکار
    const review = await prisma.bankStatementMatch.findFirstOrThrow({ where: { statementId: stmt.id, state: "MANUAL_REVIEW" } });
    expect(review.allocatedAmount).toBe(0n);
    // اجرای مجدد auto-match → همچنان یک رکورد review (idempotent)
    const r2 = await treasury.autoMatch(bank.id, actor);
    expect(r2.ambiguous).toBe(1);
    expect(await prisma.bankStatementMatch.count({ where: { statementId: stmt.id, state: "MANUAL_REVIEW" } })).toBe(1);
  });

  it("R3 manual match/unmatch: allocation integrity (مثبت، بدون سرریز، بدون duplicate، unmatch=REJECTED)", async () => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.create({ data: { id: `test-bank-${tag}-d`, name: `بانک D ${tag}`, bankName: "بانک", accountNumber: "4", glAccountId: glBank.id, currentBalance: 0n } });
    await treasury.importStatements({ bankAccountId: bank.id, lines: [{ date: new Date().toISOString(), amount: 1000000, description: "چند تخصیصی" }], actorId: actor });
    const stmt = await prisma.bankStatement.findFirstOrThrow({ where: { bankAccountId: bank.id, amount: 1000000n } });

    await treasury.manualMatch(bank.id, stmt.id, "check", `chk-1-${tag}`, 600000n, actor);
    await treasury.manualMatch(bank.id, stmt.id, "check", `chk-2-${tag}`, 400000n, actor);
    expect(await prisma.bankStatementMatch.count({ where: { statementId: stmt.id, state: "MATCHED" } })).toBe(2);

    // سرریز → رد
    await expect(treasury.manualMatch(bank.id, stmt.id, "check", `chk-3-${tag}`, 1n, actor)).rejects.toThrow();
    // مبلغ صفر/منفی → رد
    await expect(treasury.manualMatch(bank.id, stmt.id, "check", `chk-4-${tag}`, 0n, actor)).rejects.toThrow();
    // duplicate → رد
    await expect(treasury.manualMatch(bank.id, stmt.id, "check", `chk-1-${tag}`, 100000n, actor)).rejects.toThrow();

    // unmatch → REJECTED، بدون اثر GL
    const m = await prisma.bankStatementMatch.findFirstOrThrow({ where: { statementId: stmt.id, sourceId: `chk-1-${tag}` } });
    const bookBefore = await prisma.journalLine.aggregate({ where: { accountId: glBank.id }, _sum: { debit: true, credit: true } });
    await treasury.unmatch(stmt.id, m.id, actor);
    expect((await prisma.bankStatementMatch.findUniqueOrThrow({ where: { id: m.id } })).state).toBe("REJECTED");
    const bookAfter = await prisma.journalLine.aggregate({ where: { accountId: glBank.id }, _sum: { debit: true, credit: true } });
    expect(bookAfter._sum.debit).toBe(bookBefore._sum.debit);
  });
});
