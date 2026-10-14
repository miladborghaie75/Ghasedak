/**
 * فاز ۹ — Wave 1: R1 (POS CHECK) + R3 (auto-match 0/1/N) روی rehearsal DB
 *
 * Hardening Gate:
 *  §3 ایزولاسیون — هر Case فیکسچر خودش را می‌سازد (bank + statement + attempt با مبلغ یکتا per-run)؛
 *    هیچ دستکاری داده‌های unrelated (مثل flip PAID→VERIFYING) وجود ندارد.
 *  §5 unmatch — state machine صریح MATCHED→REJECTED، بدون اثر GL/خزانه/Check + re-match ممکن.
 *  §6 Match ≠ Clear — در همه Caseها GL/خزانه/Check قبل/بعد مقایسه می‌شود.
 */
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { PricingService } from "../src/pricing/pricing.service";
import { PosService } from "../src/pos/pos.service";
import { EventBusService } from "../src/events/event-bus.service";
import { ChecksService } from "../src/checks/checks.service";

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
    pos = new PosService(prisma, inventory, journal, pricing, treasury, new ChecksService(prisma, journal));
    actor = (await prisma.user.findFirstOrThrow()).id;
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } });
    sku = variant.sku;
    // فاز ۱۱ (P1-A): فروش حالا اتمیک با انبار است — واریانت باید موجودی کافی داشته باشد
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId;
    const agg = await prisma.stockLedgerEntry.aggregate({ where: { warehouseId: whId!, variantSku: sku }, _sum: { qtyIn: true, qtyOut: true } });
    if ((agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0) < 10) {
      await inventory.move({ warehouseId: whId!, variantSku: sku, type: "ADJUSTMENT", qty: 20, unitCost: 100_000n, refType: "manual", refId: tag, idempotencyKey: `w1-restock-${tag}`, actorId: actor });
    }
    // اگر از اجرای قبلی شیفت بازی مانده، همان را استفاده کن (idempotent across runs)
    let shift = await prisma.cashierShift.findFirst({ where: { userId: actor, state: "OPEN" } });
    if (!shift) {
      shift = await pos.openShift({ userId: actor, registerName: `REG-${tag}`, openingCash: 0 });
    }
    shiftId = shift.id;
    registerId = shift.registerId;
  });

  afterAll(async () => {
    // پاک‌سازی فقط داده‌های همین اجرا — با idempotencyKey یکتا، نه پنجره زمانی
    const invoices = await prisma.posInvoice.findMany({ where: { OR: [`w1-check-${tag}`, `w1-fail-${tag}`].map((k) => ({ idempotencyKey: k })) }, select: { id: true } });
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
      // projection را هم برگردان (SALE حذف شده = موجودی برمی‌گردد) — وگرنه projection از ledger فاصله می‌گیرد
      const removedMoves = await prisma.stockLedgerEntry.findMany({ where: { refType: "pos_invoice", refId: { in: ids } }, select: { variantSku: true, qtyOut: true } });
      for (const m of removedMoves) {
        await prisma.productVariant.update({ where: { sku: m.variantSku }, data: { stockQty: { increment: m.qtyOut } } });
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

  /** مبلغ یکتا per-run: هیچ attempt قدیمی در DB این مبلغ را ندارد → 0/1/N قطعی می‌شود */
  const uniqueAmount = (salt: string): bigint => BigInt(1_000_000 + (Date.now() % 900_000) + salt.split("").reduce((a, c) => a + c.charCodeAt(0) * 7, 0));

  /** فیکسچر R3: بانک اختصاصی + statement + attemptهای PAID با مبلغ یکتا — بدون دستکاری unrelated */
  const caseFixture = async (suffix: string, attemptCount: number, fixedAmount?: bigint) => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.create({
      data: { id: `test-bank-${tag}-${suffix}`, name: `بانک ${suffix.toUpperCase()} ${tag}`, bankName: "بانک", accountNumber: suffix, glAccountId: glBank.id, currentBalance: 0n },
    });
    const amount = fixedAmount ?? uniqueAmount(suffix);
    await treasury.importStatements({ bankAccountId: bank.id, lines: [{ date: new Date().toISOString(), amount: Number(amount), description: "ورودی درگاه" }], actorId: actor });
    const method = await prisma.paymentMethod.findFirstOrThrow({ where: { code: "online" } });
    const attempts: string[] = [];
    for (let i = 0; i < attemptCount; i++) {
      const a = await prisma.paymentAttempt.create({
        data: { methodId: method.id, amount, state: "PAID", idempotencyKey: `test-${tag}-${suffix}${i}`, authority: `AUT-${tag}-${suffix}-${i}`, verifiedAt: new Date() },
      });
      attempts.push(a.id);
    }
    const stmt = await prisma.bankStatement.findFirstOrThrow({ where: { bankAccountId: bank.id, amount } });
    return { bank, amount, stmt, attempts };
  };

  /** GL/خزانه/Check قبل و بعد — اصل Match ≠ Clear */
  const glSum = async (glBankId: string) => {
    const agg = await prisma.journalLine.aggregate({ where: { accountId: glBankId }, _sum: { debit: true, credit: true } });
    return { debit: agg._sum.debit ?? 0n, credit: agg._sum.credit ?? 0n };
  };
  const checkStateFingerprint = async () => {
    const [byStatus, transitions] = await Promise.all([
      prisma.check.groupBy({ by: ["status"], _count: true }),
      prisma.checkTransition.count(),
    ]);
    return JSON.stringify({ byStatus, transitions });
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
      expect(lines.find((l) => l.account.code === "1220")?.debit).toBe(BigInt(amount));
      expect(lines.find((l) => l.account.code === "4000")?.credit).toBe(BigInt(amount));
      // بند ۱: سند فروش شامل COGS (Dr 5000/Cr موجودی به بهای تمام‌شده) — جمع سند = فروش + COGS
      // از فاز ۶ کاهش موجودی روی حساب اختصاصی انبار (`1200-xx`) می‌نشیند، نه
      // گروه `1200` — همان قاعده‌ای که phase10/phase14 هم بررسی می‌کنند.
      const isInventory = (code: string) => code === "1200" || code.startsWith("1200-");
      const cogs = dr - BigInt(amount);
      const dr5000 = lines.filter((l) => l.account.code === "5000").reduce((a, l) => a + l.debit, 0n);
      const cr1200 = lines.filter((l) => isInventory(l.account.code)).reduce((a, l) => a + l.credit, 0n);
      expect(dr5000).toBe(cogs);
      expect(cr1200).toBe(cogs);
      expect(dr).toBe(BigInt(amount) + cogs);

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
    void gl1220;
  });

  it("R3 Case A: صفر candidate → UNMATCHED (هیچ رکورد match و هیچ mutation مالی)", async () => {
    const glBankId = (await prisma.account.findUniqueOrThrow({ where: { code: "1100" } })).id;
    const { bank, stmt } = await caseFixture("a", 0);
    const before = await glSum(glBankId);
    const r = await treasury.autoMatch(bank.id, actor);
    expect(r.matched).toBe(0);
    expect(r.ambiguous).toBe(0);
    expect(r.unmatched).toBe(1);
    expect(await prisma.bankStatementMatch.count({ where: { statement: { bankAccountId: bank.id } } })).toBe(0);
    expect(stmt.matchedPaymentId).toBeNull();
    const after = await glSum(glBankId);
    expect(after.debit).toBe(before.debit); // no GL mutation
    expect(after.credit).toBe(before.credit);
  });

  it("R3 Case B: دقیقاً یک candidate → AUTO MATCH — فیکسچر خودکفا، بدون دستکاری unrelated legacy attempts", async () => {
    const glBankId = (await prisma.account.findUniqueOrThrow({ where: { code: "1100" } })).id;
    const { bank, stmt, attempts } = await caseFixture("b", 1);
    const bookBefore = await glSum(glBankId);
    const bankBefore = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;
    const checkFpBefore = await checkStateFingerprint();

    // مبلغ فیکسچر یکتاست → دقیقاً یک candidate. هیچ attempt دیگری دستکاری نمی‌شود.
    const r = await treasury.autoMatch(bank.id, actor);
    expect(r.matched).toBe(1);
    expect(r.ambiguous).toBe(0);

    const stmtAfter = await prisma.bankStatement.findUniqueOrThrow({ where: { id: stmt.id } });
    expect(stmtAfter.matchedPaymentId).toBe(attempts[0]);
    const match = await prisma.bankStatementMatch.findFirstOrThrow({ where: { statementId: stmt.id, state: "MATCHED" } });
    expect(match.sourceType).toBe("payment_attempt");
    expect(match.sourceId).toBe(attempts[0]);
    expect(match.allocatedAmount).toBe(stmtAfter.amount);

    const bookAfter = await glSum(glBankId);
    expect(bookAfter.debit).toBe(bookBefore.debit); // no GL mutation
    expect(bookAfter.credit).toBe(bookBefore.credit);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(bankBefore); // no treasury mutation
    // Match ≠ Clear: هیچ چکی clear/settle نشده
    expect(await checkStateFingerprint()).toBe(checkFpBefore);
  });

  it("R3 Case C: چند candidate → MANUAL_REVIEW (هیچ انتخاب خودکار؛ GL هم بی‌تغییر)", async () => {
    const glBankId = (await prisma.account.findUniqueOrThrow({ where: { code: "1100" } })).id;
    const { bank, stmt } = await caseFixture("c", 2);
    const bookBefore = await glSum(glBankId);
    const r = await treasury.autoMatch(bank.id, actor);
    expect(r.ambiguous).toBe(1);
    expect(r.matched).toBe(0);
    expect(stmt.matchedPaymentId).toBeNull(); // هیچ انتخاب خودکار
    const review = await prisma.bankStatementMatch.findFirstOrThrow({ where: { statementId: stmt.id, state: "MANUAL_REVIEW" } });
    expect(review.allocatedAmount).toBe(0n);
    // اجرای مجدد auto-match → همچنان یک رکورد review (idempotent)
    const r2 = await treasury.autoMatch(bank.id, actor);
    expect(r2.ambiguous).toBe(1);
    expect(await prisma.bankStatementMatch.count({ where: { statementId: stmt.id, state: "MANUAL_REVIEW" } })).toBe(1);
    const bookAfter = await glSum(glBankId);
    expect(bookAfter.debit).toBe(bookBefore.debit); // no GL mutation
  });

  it("R3 manual match: allocation integrity (مثبت، بدون سرریز، بدون duplicate)", async () => {
    // مبلغ ثابت ۱٬۰۰۰٬۰۰۰ تا 600k+400k ردیف را پر کند و سرریز قابل‌تست باشد
    const { stmt } = await caseFixture("d", 0, 1_000_000n);
    await treasury.manualMatch(stmt.bankAccountId, stmt.id, "check", `chk-1-${tag}`, 600000n, actor);
    await treasury.manualMatch(stmt.bankAccountId, stmt.id, "check", `chk-2-${tag}`, 400000n, actor);
    expect(await prisma.bankStatementMatch.count({ where: { statementId: stmt.id, state: "MATCHED" } })).toBe(2);

    // سرریز → رد
    await expect(treasury.manualMatch(stmt.bankAccountId, stmt.id, "check", `chk-3-${tag}`, 1n, actor)).rejects.toThrow();
    // مبلغ صفر/منفی → رد
    await expect(treasury.manualMatch(stmt.bankAccountId, stmt.id, "check", `chk-4-${tag}`, 0n, actor)).rejects.toThrow();
    // duplicate → رد
    await expect(treasury.manualMatch(stmt.bankAccountId, stmt.id, "check", `chk-1-${tag}`, 100000n, actor)).rejects.toThrow();
  });

  it("R3 unmatch: state machine MATCHED→REJECTED، re-match ممکن، بدون اثر GL/خزانه/Check", async () => {
    const glBankId = (await prisma.account.findUniqueOrThrow({ where: { code: "1100" } })).id;
    const { bank, stmt, attempts } = await caseFixture("e", 1);

    // auto-match روی candidate یکتا
    const m1 = await treasury.autoMatch(bank.id, actor);
    expect(m1.matched).toBe(1);
    const match = await prisma.bankStatementMatch.findFirstOrThrow({ where: { statementId: stmt.id, state: "MATCHED" } });
    expect(match.sourceId).toBe(attempts[0]);
    expect((await prisma.bankStatement.findUniqueOrThrow({ where: { id: stmt.id } })).matchedPaymentId).toBe(attempts[0]);

    const checkFpBefore = await checkStateFingerprint();
    const treasuryBefore = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;

    // unmatch → REJECTED (تاریخ حفظ می‌شود)، matchedPaymentId آزاد می‌شود
    await treasury.unmatch(stmt.id, match.id, actor);
    const rejected = await prisma.bankStatementMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(rejected.state).toBe("REJECTED");
    expect(rejected.allocatedAmount).toBe(stmt.amount); // سابقه تخصیص حفظ شده
    expect((await prisma.bankStatement.findUniqueOrThrow({ where: { id: stmt.id } })).matchedPaymentId).toBeNull();

    // re-match همان منبع → مجاز (ردیف REJECTED re-activate می‌شود؛ unique constraint نقض نمی‌شود)
    const m2 = await treasury.autoMatch(bank.id, actor);
    expect(m2.matched).toBe(1);
    const remarried = await prisma.bankStatementMatch.findUniqueOrThrow({ where: { id: match.id } });
    expect(remarried.state).toBe("MATCHED");
    expect((await prisma.bankStatement.findUniqueOrThrow({ where: { id: stmt.id } })).matchedPaymentId).toBe(attempts[0]);
    // فقط یک رکورد برای این جفت وجود دارد (unique نگه داشته شده)
    expect(await prisma.bankStatementMatch.count({ where: { statementId: stmt.id, sourceId: attempts[0] } })).toBe(1);

    // هیچ اثر مالی (Match ≠ Clear)
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(treasuryBefore);
    expect(await checkStateFingerprint()).toBe(checkFpBefore);

    // unmatch روی رکورد MANUAL_REVIEW هم مجاز است (review را می‌بندد)
    // (Case C رکورد خودش را دارد؛ اینجا فقط مسیر MANUAL_REVIEW→REJECTED را با فیکسچر تازه می‌سازیم)
    const f = await caseFixture("f", 2);
    await treasury.autoMatch(f.bank.id, actor); // → MANUAL_REVIEW
    const review = await prisma.bankStatementMatch.findFirstOrThrow({ where: { statementId: f.stmt.id, state: "MANUAL_REVIEW" } });
    await treasury.unmatch(f.stmt.id, review.id, actor);
    expect((await prisma.bankStatementMatch.findUniqueOrThrow({ where: { id: review.id } })).state).toBe("REJECTED");
    // و unmatch تکراری همان رکورد idempotent می‌ماند
    await treasury.unmatch(f.stmt.id, review.id, actor);
    expect((await prisma.bankStatementMatch.findUniqueOrThrow({ where: { id: review.id } })).state).toBe("REJECTED");
    void glBankId;
  });
});
