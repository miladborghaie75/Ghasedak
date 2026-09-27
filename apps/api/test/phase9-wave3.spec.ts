/**
 * فاز ۹ — Wave 3: scheduler واقعی + تفکیک CAS + سناریوهای cross-domain + invariants
 *
 * پوشش (STEP 1/3/4/5/6/7/8/9):
 *  - Scheduler: first-run / same-day duplicate / DB-idempotency با instance تازه /
 *    overdue consolidation (یک ردیف به‌ازای هر روز، نه هر روزِ از دست رفته) /
 *    suppression بعد از CLEARED/BOUNCED/CANCELLED
 *  - CAS: تفکیک CONCURRENT_MODIFICATION از INVALID_TRANSITION به‌صورت قطعی
 *    (خوانش stale + CAS اجباریِ شکست) + race واقعی با Promise.allSettled و
 *    exactly-1 CheckTransition/Journal/Outbox
 *  - Match/Clear/Unmatch invariants: match هیچ سند/lifecycle/treasury نمی‌سازد؛
 *    unmatch هم؛ فقط clear صریح اثر مالی دارد
 *  - سناریوهای A–D با invariants حسابداری (سند متوازن، revenue یک‌بار، double-clear/bounce ممنوع)
 *  - Treasury projection == GL delta روی بانک ایزوله (drift دمو را پنهان نمی‌کنیم — root cause: سندهای seed)
 *  - Outbox: dispatch تکراری idempotent — consumer عملیات business را دوباره اجرا نمی‌کند
 *  - RBAC: گارد permission — بدون هویت 401، بدون مجوز 403 (بدون mutation)
 */
import "reflect-metadata";
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";
import { ChecksService } from "../src/checks/checks.service";
import { ReminderService } from "../src/checks/reminder.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { EventBusService } from "../src/events/event-bus.service";
import { PricingService } from "../src/pricing/pricing.service";
import { PurchasingService } from "../src/inventory/purchasing.service";
import { PosService } from "../src/pos/pos.service";
import { PermissionsGuard, PERMISSION_KEY } from "../src/auth/permissions.guard";

jest.setTimeout(120_000);

describe("Phase 9 Wave 3 — scheduler / CAS / cross-domain hardening", () => {
  let prisma: PrismaService;
  let journal: JournalService;
  let checks: ChecksService;
  let reminders: ReminderService;
  let treasury: TreasuryService;
  let purchasing: PurchasingService;
  let pos: PosService;
  let bus: EventBusService;
  let actor: string;
  const tag = `w3${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const testStart = new Date();
  const day = (n: number) => new Date(Date.now() + n * 86_400_000);

  /** بانک ایزوله با ماندهٔ اولیه صفر — projection این حساب فقط اثر تست‌های همین اجراست */
  let bank: { id: string; currentBalance: bigint };

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    journal = new JournalService(prisma);
    checks = new ChecksService(prisma, journal);
    reminders = new ReminderService(prisma);
    treasury = new TreasuryService(prisma, journal);
    const inv = new InventoryService(prisma, new InventorySettingsService(prisma));
    bus = new EventBusService(prisma);
    purchasing = new PurchasingService(prisma, inv, bus, treasury, checks);
    pos = new PosService(prisma, inv, journal, new PricingService(prisma, bus), treasury, checks);
    actor = (await prisma.user.findFirstOrThrow()).id;
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const created = await prisma.bankAccount.create({
      data: { id: `test-bank-${tag}-w3`, name: `بانک W3 ${tag}`, bankName: "بانک تست W3", accountNumber: "w3", glAccountId: glBank.id, currentBalance: 0n },
    });
    bank = { id: created.id, currentBalance: created.currentBalance };
  });

  afterAll(async () => {
    // پاک‌سازی فقط داده‌های همین اجرا (tag-محور) — الگوی Wave 2.
    // نکتهٔ Wave 3: چک‌های ساخته‌شده در مسیر POS/خرید کلیدشان `w3-pos-{tag}...` است (نه پیشوند w3-{tag}) —
    // پس با بانک ایزوله هم جمع می‌کنیم (همهٔ چک‌های این اجرا به آن bind شده‌اند).
    const checkRows = await prisma.check.findMany({
      where: { OR: [{ idempotencyKey: { startsWith: `w3-${tag}` } }, { treasuryBankAccountId: bank.id }] },
      select: { id: true },
    });
    const checkIds = checkRows.map((c) => c.id);
    // فاکتورهای POS متصل به چک‌های این اجرا
    const posPayments = checkIds.length ? await prisma.posPayment.findMany({ where: { checkId: { in: checkIds } }, select: { invoiceId: true } }) : [];
    const posInvoiceIds = [...new Set(posPayments.map((p) => p.invoiceId))];
    for (const invId of posInvoiceIds) {
      await prisma.posInvoiceItem.deleteMany({ where: { invoiceId: invId } });
      await prisma.posInvoice.deleteMany({ where: { id: invId } });
      await prisma.journalEntry.deleteMany({ where: { sourceType: "pos_invoice", sourceId: invId } });
      await prisma.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: invId } });
    }
    if (checkIds.length) {
      await prisma.posPayment.deleteMany({ where: { checkId: { in: checkIds } } }).catch(() => undefined);
      await prisma.purchasePayment.deleteMany({ where: { checkId: { in: checkIds } } }).catch(() => undefined);
      await prisma.checkTransition.deleteMany({ where: { checkId: { in: checkIds } } });
      await prisma.accountsReceivable.deleteMany({ where: { refType: "check", refId: { in: checkIds } } });
      await prisma.paymentSettlement.deleteMany({ where: { checkId: { in: checkIds } } }).catch(() => undefined);
      await prisma.check.deleteMany({ where: { id: { in: checkIds } } });
      await prisma.journalEntry.deleteMany({ where: { sourceType: "check_transition", OR: checkIds.map((id) => ({ sourceId: { startsWith: id } })) } });
    }
    await prisma.reminder.deleteMany({ where: { relatedEntityType: "check", relatedEntityId: { in: checkIds.length ? checkIds : ["__none__"] } } });
    // صورتحساب/تطبیق/بانک ایزوله
    await prisma.bankStatementMatch.deleteMany({ where: { statement: { bankAccountId: bank.id } } }).catch(() => undefined);
    await prisma.bankStatement.deleteMany({ where: { bankAccountId: bank.id } }).catch(() => undefined);
    await prisma.bankAccount.deleteMany({ where: { id: bank.id } }).catch(() => undefined);
    // فاکتورهای خرید این اجرا (تامین‌کنندهٔ tag-دار)
    const sup = await prisma.supplier.findFirst({ where: { name: { startsWith: `تست-تامین-${tag}` } }, select: { id: true } });
    if (sup) {
      const invoices = await prisma.purchaseInvoice.findMany({ where: { supplierId: sup.id }, select: { id: true } });
      for (const inv of invoices) {
        await prisma.purchasePayment.deleteMany({ where: { invoiceId: inv.id } }).catch(() => undefined);
        await prisma.accountsPayable.deleteMany({ where: { refType: "purchase_invoice", refId: inv.id } });
        await prisma.purchaseInvoiceItem.deleteMany({ where: { invoiceId: inv.id } });
        await prisma.purchaseInvoice.deleteMany({ where: { id: inv.id } });
      }
      await prisma.supplierAccount.deleteMany({ where: { supplierId: sup.id } }).catch(() => undefined);
      await prisma.supplier.deleteMany({ where: { id: sup.id } }).catch(() => undefined);
    }
    // نوتیفیکیشن‌های dispatch شده در همین اجرا
    await prisma.notification.deleteMany({ where: { createdAt: { gte: testStart }, templateKey: { startsWith: "check-cleared:" } } }).catch(() => undefined);
    // مشتری‌های این اجرا
    const testCustomers = await prisma.customer.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    for (const c of testCustomers) {
      await prisma.customerAccount.deleteMany({ where: { customerId: c.id } }).catch(() => undefined);
      await prisma.customer.deleteMany({ where: { id: c.id } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  // ---------- helpers ----------

  const glSum = async (code: string) => {
    const acc = await prisma.account.findUniqueOrThrow({ where: { code }, select: { id: true } });
    const agg = await prisma.journalLine.aggregate({ where: { accountId: acc.id }, _sum: { debit: true, credit: true } });
    return { debit: agg._sum.debit ?? 0n, credit: agg._sum.credit ?? 0n };
  };
  const balanceOf = async (code: string) => {
    const s = await glSum(code);
    return s.debit - s.credit;
  };

  let customerSeq = 0;
  const makeCustomer = async () => {
    customerSeq += 1;
    const mobileTail = String((Date.now() + customerSeq * 7919) % 10_000_000).padStart(7, "0");
    return prisma.customer.create({ data: { mobile: `0915${mobileTail}`, name: `مشتری Wave3 ${tag}` } });
  };

  const makeReceivedCheck = async (amount = 1_000_000, dueIn = 10) => {
    const c = await makeCustomer();
    const chk = await checks.create({
      direction: "RECEIVED",
      number: `CH-${tag}-${Math.floor(Math.random() * 100000)}`,
      bankName: "بانک تست W3",
      amount,
      dueDate: day(dueIn),
      customerId: c.id,
      idempotencyKey: `w3-${tag}-${c.id}`,
      actorId: actor,
      treasuryBankAccountId: bank.id,
    });
    return { check: chk, customer: c };
  };

  /**
   * چک‌های ساخته‌شده در مسیر POS/خرید treasuryBankAccountId ندارند (پیش‌فرض: بانک اصلی GL 1100).
   * fixture: حساب بانکی وصول را روی بانک ایزولهٔ تست ست می‌کنیم تا projection قطعی قابل assert باشد.
   */
  const assignTreasuryBank = (checkId: string) => prisma.check.update({ where: { id: checkId }, data: { treasuryBankAccountId: bank.id } });

  /** سند check_transition یک چک */
  const transitionJe = async (checkId: string, toStatus: string) =>
    prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "check_transition", sourceId: `${checkId}:${toStatus}` },
      include: { lines: { include: { account: true } } },
    });
  const expectBalanced = (je: { lines: Array<{ debit: bigint; credit: bigint }> }) => {
    const dr = je.lines.filter((l) => l.debit > 0n).reduce((a, l) => a + l.debit, 0n);
    const cr = je.lines.filter((l) => l.credit > 0n).reduce((a, l) => a + l.credit, 0n);
    expect(dr).toBe(cr);
  };

  /** چک → statement → manualMatch — فقط association؛ هیچ اثر مالی */
  const matchCheckToStatement = async (checkId: string, amount: number, description: string) => {
    await treasury.importStatements({ bankAccountId: bank.id, lines: [{ date: new Date().toISOString(), amount, description }], actorId: actor });
    const stmt = await prisma.bankStatement.findFirstOrThrow({ where: { bankAccountId: bank.id, amount: BigInt(amount), description }, orderBy: { date: "desc" } });
    await treasury.manualMatch(bank.id, stmt.id, "check", checkId, BigInt(amount), actor);
    return stmt;
  };

  /**
   * `$transaction` را موقتاً طوری می‌بندیم که اولین خوانش check stale باشد (snapshot قبل از تغییر)
   * و updateMany همیشه count=0 برگرداند (CAS اجباریِ شکست) — پوشش قطعی هر دو شاخهٔ re-read.
   */
  const withStaleReadAndCasFail = async <T>(checkId: string, advanceVersion: boolean, fn: () => Promise<T>): Promise<T> => {
    const snapshot = await prisma.check.findUniqueOrThrow({ where: { id: checkId } });
    if (advanceVersion) {
      await prisma.check.update({ where: { id: checkId }, data: { lifecycleVersion: snapshot.lifecycleVersion + 1, status: "DEPOSITED" } });
    }
    let checkReads = 0;
    const target = prisma as unknown as Record<string, unknown>;
    const txProxy = new Proxy(prisma as unknown as object, {
      get(t, prop) {
        if (prop === "check") {
          return {
            findUnique: async (args: unknown) => {
              checkReads += 1;
              if (checkReads === 1) return snapshot; // اولین خوانش سرویس — stale
              return (t as unknown as PrismaService).check.findUnique(args as never);
            },
            updateMany: async () => ({ count: 0 }), // CAS اجباریِ شکست
          };
        }
        const v = Reflect.get(t as object, prop);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    }) as unknown as Prisma.TransactionClient;
    const orig = target.$transaction;
    (target as Record<string, unknown>).$transaction = (f: (tx: Prisma.TransactionClient) => unknown) => f(txProxy);
    try {
      return await fn();
    } finally {
      if (advanceVersion) {
        await prisma.check.update({ where: { id: checkId }, data: { lifecycleVersion: snapshot.lifecycleVersion, status: snapshot.status } });
      }
      target.$transaction = orig;
    }
  };

  // ---------- STEP 1: scheduler ----------

  it("scheduler: first-run اجرا می‌شود، same-day rerun = skip، instance تازه = zero duplicate (idempotency روی DB)", async () => {
    await makeReceivedCheck(300_000, 7); // D-7
    const r1 = await reminders.runScheduled();
    expect(r1.ran).toBe(true);
    expect(r1.result?.created).toBeGreaterThanOrEqual(1);
    // همان day — از حافظه skip می‌شود
    const r2 = await reminders.runScheduled();
    expect(r2.ran).toBe(false);
    expect(r2.reason).toBe("already-run-today");
    // instance تازه (restart) — idempotency واقعی روی idempotencyKey unique است: هیچ ردیف تکراری
    const fresh = new ReminderService(prisma);
    const r3 = await fresh.runScheduled();
    expect(r3.ran).toBe(true);
    expect(r3.result?.created).toBe(0);
  });

  it("scheduler: overdue consolidation — هر روزِ تهران فقط یک OVERDUE؛ اجرای دوبارهٔ همان روز = صفر", async () => {
    const { check } = await makeReceivedCheck(250_000, -2); // گذشته از سررسید
    const t1 = new Date(Date.now() - 1 * 86_400_000); // دیروز تهران
    const a = await reminders.runDaily({ now: t1 });
    const b = await reminders.runDaily({ now: new Date() }); // امروز
    expect(a.created).toBeGreaterThanOrEqual(1);
    expect(b.created).toBeGreaterThanOrEqual(1);
    // دقیقاً یک ردیف به‌ازای هر روز — consolidation (نه همهٔ روزهای میانی)
    const rows = await prisma.reminder.findMany({ where: { relatedEntityId: check.id, status: "PENDING" } });
    expect(rows.length).toBe(2);
    const keys = new Set(rows.map((r) => r.idempotencyKey));
    expect(keys.size).toBe(2); // کلید روزانهٔ متفاوت
    // اجرای دوبارهٔ همان روز = zero duplicate
    const c = await reminders.runDaily({ now: new Date() });
    expect(c.created).toBe(0);
  });

  it("scheduler: suppression — cleared/bounced/cancelled هیچ یادآور PENDING باقی نمی‌گذارند", async () => {
    const { check: c1 } = await makeReceivedCheck(200_000, 3);
    const { check: c2 } = await makeReceivedCheck(200_000, 3);
    const sup = await purchasing.createSupplier({ name: `تست-تامین-${tag}-sup`, actorId: actor });
    const c3 = await checks.create({
      direction: "ISSUED", number: `CHC-${tag}`, bankName: "بانک تست W3", amount: 120_000, dueDate: day(3),
      supplierId: sup.id, idempotencyKey: `w3-${tag}-${sup.id}`, actorId: actor, treasuryBankAccountId: bank.id,
    });
    await reminders.runDaily();
    expect(await prisma.reminder.count({ where: { relatedEntityId: c1.id, status: "PENDING" } })).toBeGreaterThanOrEqual(1);

    await checks.clear({ checkId: c1.id, idempotencyKey: `w3-${tag}-sup-clr`, actorId: actor });
    await checks.bounce({ checkId: c2.id, idempotencyKey: `w3-${tag}-sup-bnc`, actorId: actor });
    await checks.cancel({ checkId: c3.id, idempotencyKey: `w3-${tag}-sup-cxl`, actorId: actor });
    const r = await reminders.runDaily();
    expect(r.cancelled).toBeGreaterThanOrEqual(3);
    for (const id of [c1.id, c2.id, c3.id]) {
      expect(await prisma.reminder.count({ where: { relatedEntityId: id, status: "PENDING" } })).toBe(0);
    }
  });

  // ---------- STEP 3: CAS conflict classification ----------

  it("CAS: حالت پایانی — CLEARED → CLEARED در allow-list رد می‌شود → INVALID_TRANSITION (بدون CAS)", async () => {
    const { check } = await makeReceivedCheck(150_000, 9);
    await checks.clear({ checkId: check.id, idempotencyKey: `w3-${tag}-cas-pre`, actorId: actor });
    const err = await checks
      .transition({ checkId: check.id, toStatus: "CLEARED", idempotencyKey: `w3-${tag}-cas-a` })
      .then(() => null)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as { response?: { code?: string } }).response?.code).toBe("INVALID_TRANSITION");
    // هیچ سند دومی برای وصول همان چک
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:CLEARED` } })).toBe(1);
  });

  it("CAS: شاخهٔ INVALID_TRANSITION (قطعی) — خوانش stale، version تغییری نکرده، مسیر عملیات باید fail کند → BadRequest", async () => {
    const { check } = await makeReceivedCheck(150_000, 9);
    const err = await withStaleReadAndCasFail(check.id, false, () =>
      checks.transition({ checkId: check.id, toStatus: "CLEARED", idempotencyKey: `w3-${tag}-cas-b` }),
    ).then(() => null)
    .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as { response?: { code?: string } }).response?.code).toBe("INVALID_TRANSITION");
    expect(await prisma.checkTransition.count({ where: { checkId: check.id, toStatus: "CLEARED" } })).toBe(0);
  });

  it("CAS: قطعی — خوانش stale و version پیش‌رفته از مسیر دیگر → CONCURRENT_MODIFICATION", async () => {
    const { check } = await makeReceivedCheck(160_000, 9);
    const err = await withStaleReadAndCasFail(check.id, true, () =>
      checks.transition({ checkId: check.id, toStatus: "CLEARED", idempotencyKey: `w3-${tag}-cas-c` }),
    ).then(() => null)
    .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as { response?: { code?: string } }).response?.code).toBe("CONCURRENT_MODIFICATION");
    expect(await prisma.checkTransition.count({ where: { checkId: check.id, toStatus: "CLEARED" } })).toBe(0);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: { startsWith: check.id } } })).toBe(0);
  });

  it("CAS race: دو transition همزمان → فقط یک برنده؛ loser یا CONCURRENT_MODIFICATION یا INVALID_TRANSITION؛ exactly 1 CheckTransition/Outbox", async () => {
    const { check } = await makeReceivedCheck(180_000, 8);
    const results = await Promise.allSettled([
      checks.transition({ checkId: check.id, toStatus: "DEPOSITED", idempotencyKey: `w3-${tag}-race-a`, actorId: actor }),
      checks.transition({ checkId: check.id, toStatus: "DEPOSITED", idempotencyKey: `w3-${tag}-race-b`, actorId: actor }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    const reason = (results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason;
    // در READ COMMITTED بازنده بسته به serialize شدن txها به یکی از این دو می‌رسد؛
    // هر دو کد «مشخص» هستند (نه generic) — پوشش قطعی هر شاخه در دو تست stale-read بالا.
    expect([BadRequestException, ConflictException]).toContain(reason.constructor);
    if (reason instanceof ConflictException) expect((reason.getResponse() as { code?: string }).code).toBe("CONCURRENT_MODIFICATION");
    if (reason instanceof BadRequestException) expect((reason.getResponse() as { code?: string }).code).toBe("INVALID_TRANSITION");
    // invariants اصلی race: فقط یک گذار واقعی (v0 ثبتِ ساخت چک شمرده نمی‌شود)
    expect(await prisma.checkTransition.count({ where: { checkId: check.id, toStatus: "DEPOSITED" } })).toBe(1);
    expect(await prisma.domainEventOutbox.count({ where: { name: "CheckTransitioned", payload: { path: ["checkId"], equals: check.id } as never } })).toBe(1);
    expect((await prisma.check.findUniqueOrThrow({ where: { id: check.id } })).lifecycleVersion).toBe(1);
  });

  it("CAS race: دو clear همزمان → فقط یک سند وصول؛ دو bounce همزمان → فقط یک سند برگشت", async () => {
    const { check: c1 } = await makeReceivedCheck(210_000, 6);
    const r1 = await Promise.allSettled([
      checks.clear({ checkId: c1.id, idempotencyKey: `w3-${tag}-cc1`, actorId: actor }),
      checks.clear({ checkId: c1.id, idempotencyKey: `w3-${tag}-cc2`, actorId: actor }),
    ]);
    expect(r1.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${c1.id}:CLEARED` } })).toBe(1);
    expect(await prisma.checkTransition.count({ where: { checkId: c1.id, toStatus: "CLEARED" } })).toBe(1);

    const { check: c2 } = await makeReceivedCheck(220_000, 6);
    const r2 = await Promise.allSettled([
      checks.bounce({ checkId: c2.id, idempotencyKey: `w3-${tag}-cb1`, actorId: actor }),
      checks.bounce({ checkId: c2.id, idempotencyKey: `w3-${tag}-cb2`, actorId: actor }),
    ]);
    expect(r2.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${c2.id}:BOUNCED` } })).toBe(1);
  });

  // ---------- STEP 4: Match / Clear / Unmatch invariants ----------

  it("invariants: match هیچ سند/projection/lifecycle نمی‌سازد؛ unmatch هم هیچ؛ فقط clear صریح اثر دارد", async () => {
    const { check } = await makeReceivedCheck(400_000, 12);
    const projBefore = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;
    const stmt = await matchCheckToStatement(check.id, 400_000, `مچ W3 ${tag}`);

    // MATCH: بدون journal، بدون lifecycle، بدون treasury
    expect((await prisma.check.findUniqueOrThrow({ where: { id: check.id } })).status).toBe("RECEIVED");
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: { startsWith: check.id } } })).toBe(0);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBefore);

    // UNMATCH: بدون journal، بدون treasury، بدون lifecycle
    const m = await prisma.bankStatementMatch.findFirstOrThrow({ where: { statementId: stmt.id, sourceType: "check" } });
    await treasury.unmatch(stmt.id, m.id, actor);
    expect((await prisma.check.findUniqueOrThrow({ where: { id: check.id } })).status).toBe("RECEIVED");
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: { startsWith: check.id } } })).toBe(0);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBefore);

    // CLEAR صریح — الان اثر مالی
    await checks.clear({ checkId: check.id, idempotencyKey: `w3-${tag}-inv-clr`, actorId: actor });
    expect((await prisma.check.findUniqueOrThrow({ where: { id: check.id } })).status).toBe("CLEARED");
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBefore + 400_000n);
    // clear دوم → INVALID_TRANSITION (allow-list وضعیت پایانی)
    await expect(checks.clear({ checkId: check.id, idempotencyKey: `w3-${tag}-inv-clr2`, actorId: actor })).rejects.toThrow(BadRequestException);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:CLEARED` } })).toBe(1);
  });

  it("checkByStatement: matched→canClear، بعد از clear→clearedBefore و بدون canClear؛ بدون match→matched:false", async () => {
    const { check } = await makeReceivedCheck(350_000, 5);
    await matchCheckToStatement(check.id, 350_000, `stcheck W3 ${tag}`);
    const stmt = await prisma.bankStatement.findFirstOrThrow({ where: { bankAccountId: bank.id, amount: 350_000n }, orderBy: { date: "desc" } });

    const before = await treasury.checkByStatement(stmt.id);
    expect(before.matched).toBe(true);
    expect(before.check?.canClear).toBe(true);
    expect(before.check?.clearedBefore).toBe(false);

    await checks.clear({ checkId: check.id, idempotencyKey: `w3-${tag}-sbs`, actorId: actor });
    const after = await treasury.checkByStatement(stmt.id);
    expect(after.check?.clearedBefore).toBe(true);
    expect(after.check?.canClear).toBe(false);

    await treasury.importStatements({ bankAccountId: bank.id, lines: [{ date: new Date().toISOString(), amount: 111_000, description: `بدون چک ${tag}` }], actorId: actor });
    const noMatch = await treasury.checkByStatement((await prisma.bankStatement.findFirstOrThrow({ where: { description: `بدون چک ${tag}` } })).id);
    expect(noMatch.matched).toBe(false);
  });

  // ---------- STEP 5/6: Scenario A — POS check full chain ----------

  it("Scenario A: POS sale → check RECEIVED → match → clear — revenue یک‌بار، bank فقط در clear، سندها متوازن", async () => {
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId;
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } });
    const ledger = await prisma.stockLedgerEntry.findFirst({ where: { warehouseId: whId!, variantSku: variant.sku } });
    if (!ledger) {
      const inv = new InventoryService(prisma, new InventorySettingsService(prisma));
      await inv.move({ warehouseId: whId!, variantSku: variant.sku, type: "ADJUSTMENT", qty: 10, unitCost: 100000n, refType: "manual", refId: tag, idempotencyKey: `w3-restock-${tag}`, actorId: actor });
    }
    const shift = await prisma.cashierShift.findFirst({ where: { userId: actor, state: "OPEN" } })
      ?? await pos.openShift({ userId: actor, registerName: `REG-${tag}`, openingCash: 0 });
    const customer = await makeCustomer();
    const ep = await new PricingService(prisma, bus).effectivePrice(variant.sku, "pos");
    const amount = Number(ep.salePrice ?? ep.price);

    const sale = await pos.sale({
      shiftId: shift.id,
      lines: [{ sku: variant.sku, qty: 1 }],
      payments: [{ methodCode: "check", amount, checkNumber: `CHP-${tag}-A`, bankName: "بانک تست W3", dueDateDays: 20 }],
      customerMobile: customer.mobile,
      customerName: customer.name ?? undefined,
      idempotencyKey: `w3-pos-${tag}-A`,
    }, actor);

    const invoice = await prisma.posInvoice.findUniqueOrThrow({ where: { id: sale.id }, include: { payments: true } });
    const checkId = invoice.payments[0].checkId!;
    expect(checkId).toBeTruthy();
    await assignTreasuryBank(checkId); // fixture: بانک وصول = بانک ایزولهٔ تست

    // فروش: revenue یک‌بار (یک خط 4000)، سند متوازن، 1220 بدهکار
    const saleJe = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "pos_invoice", sourceId: invoice.id }, include: { lines: { include: { account: true } } } });
    expectBalanced(saleJe);
    expect(saleJe.lines.filter((l) => l.account.code === "4000")).toHaveLength(1);
    expect(saleJe.lines.find((l) => l.account.code === "1220")?.debit).toBe(BigInt(amount));
    const projAfterSale = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;

    // match — هیچ اثر مالی
    await matchCheckToStatement(checkId, amount, `سناریو A ${tag}`);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projAfterSale);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${checkId}:CLEARED` } })).toBe(0);

    // clear — بانک فقط همین‌جا
    const glBankBefore = await balanceOf("1100");
    await checks.clear({ checkId, idempotencyKey: `w3-${tag}-A-clr`, actorId: actor });
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projAfterSale + BigInt(amount));
    expect(await balanceOf("1100")).toBe(glBankBefore + BigInt(amount));

    // سند وصول متوازن + exactly 1 + revenue دوباره ثبت نشده
    const clrJe = await transitionJe(checkId, "CLEARED");
    expectBalanced(clrJe);
    expect(clrJe.lines.find((l) => l.account.code === "1100")?.debit).toBe(BigInt(amount));
    expect(clrJe.lines.filter((l) => l.account.code === "4000")).toHaveLength(0);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${checkId}:CLEARED` } })).toBe(1);
    // AR CHECK تسویه
    expect((await prisma.accountsReceivable.findFirstOrThrow({ where: { refType: "check", refId: checkId, exposureType: "CHECK" } })).state).toBe("SETTLED");
    // duplicate request → journal delta = 0
    const rr = await checks.clear({ checkId, idempotencyKey: `w3-${tag}-A-clr`, actorId: actor }); // همان کلید → replay
    expect(rr.replayed).toBe(true);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${checkId}:CLEARED` } })).toBe(1);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projAfterSale + BigInt(amount));
  });

  // ---------- Scenario B — purchase check chain ----------

  it("Scenario B: خرید → چک ISSUED → match → clear — صدور بانک را کم نمی‌کند؛ وصول کم می‌کند؛ AP درست؛ bounce effective-paid را اصلاح می‌کند", async () => {
    const sup = await purchasing.createSupplier({ name: `تست-تامین-${tag}-B`, actorId: actor });
    const invRow = await prisma.purchaseInvoice.create({
      data: { number: `PINV-W3-${tag}-B`, supplierId: sup.id, state: "POSTED", subtotal: 700_000n, grandTotal: 700_000n, items: { create: [{ variantSku: (await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } })).sku, qty: 1, unitCost: 700_000n }] } },
      select: { id: true },
    });
    await prisma.accountsPayable.create({ data: { accountPId: (await prisma.supplierAccount.findUniqueOrThrow({ where: { supplierId: sup.id } })).id, refType: "purchase_invoice", refId: invRow.id, amount: 700_000n } });

    const projBeforeIssue = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;
    const pay = await purchasing.payInvoice({ invoiceId: invRow.id, amount: 450_000, method: "check", checkNumber: `CHP-${tag}-B`, checkBankName: "بانک تست W3", checkDueDateDays: 15, actorId: actor });
    const checkId = pay.checkId!;
    await assignTreasuryBank(checkId); // fixture: بانک وصول = بانک ایزولهٔ تست
    // صدور: هیچ حرکت بانک + سند صدور متوازن Dr 2100/Cr 2110
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBeforeIssue);
    const issueJe = await transitionJe(checkId, "ISSUED");
    expectBalanced(issueJe);
    expect(issueJe.lines.find((l) => l.account.code === "2100")?.debit).toBe(450_000n);
    expect(issueJe.lines.find((l) => l.account.code === "2110")?.credit).toBe(450_000n);

    await matchCheckToStatement(checkId, 450_000, `سناریو B ${tag}`);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBeforeIssue);

    // clear — بانک کم می‌شود
    await checks.clear({ checkId, idempotencyKey: `w3-${tag}-B-clr`, actorId: actor });
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBeforeIssue - 450_000n);
    const clrJe = await transitionJe(checkId, "CLEARED");
    expectBalanced(clrJe);
    // AP: پرداخت مؤثر شامل چک وصول‌شده است
    const ap = await prisma.accountsPayable.findFirstOrThrow({ where: { refType: "purchase_invoice", refId: invRow.id } });
    expect(ap.paidAmount).toBe(450_000n);
    expect(ap.state).toBe("PARTIAL");
    // برگشت بعد از وصول → paidAmount صفر (پرداخت چکیِ مرده از effective-paid خارج) + chargeback به بانک
    await checks.bounce({ checkId, idempotencyKey: `w3-${tag}-B-bnc`, actorId: actor });
    const ap2 = await prisma.accountsPayable.findFirstOrThrow({ where: { refType: "purchase_invoice", refId: invRow.id } });
    expect(ap2.paidAmount).toBe(0n);
    expect(ap2.state).toBe("OPEN");
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBeforeIssue);
  });

  // ---------- Scenario C — received bounce (before clear) ----------

  it("Scenario C: POS → RECEIVED → match → bounce — AR به TRADE، 1210/1220 متوازن، revenue دوباره ثبت نمی‌شود", async () => {
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId;
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } });
    const shift = await prisma.cashierShift.findFirst({ where: { userId: actor, state: "OPEN" } })
      ?? await pos.openShift({ userId: actor, registerName: `REG-${tag}-C`, openingCash: 0 });
    const customer = await makeCustomer();
    const epC = await new PricingService(prisma, bus).effectivePrice(variant.sku, "pos");
    const amount = Number(epC.salePrice ?? epC.price);
    const sale = await pos.sale({
      shiftId: shift.id,
      lines: [{ sku: variant.sku, qty: 1 }],
      payments: [{ methodCode: "check", amount, checkNumber: `CHP-${tag}-C`, bankName: "بانک تست W3", dueDateDays: 10 }],
      customerMobile: customer.mobile,
      customerName: customer.name ?? undefined,
      idempotencyKey: `w3-pos-${tag}-C`,
    }, actor);
    const invoice = await prisma.posInvoice.findUniqueOrThrow({ where: { id: sale.id }, include: { payments: true } });
    const checkId = invoice.payments[0].checkId!;
    await assignTreasuryBank(checkId);
    await matchCheckToStatement(checkId, amount, `سناریو C ${tag}`);

    const ar = await prisma.accountsReceivable.findFirstOrThrow({ where: { refType: "check", refId: checkId, exposureType: "CHECK" } });
    const projBefore = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;
    const r = await checks.bounce({ checkId, idempotencyKey: `w3-${tag}-C-bnc`, actorId: actor });
    expect(r.check.status).toBe("BOUNCED");

    // سند برگشت متوازن Dr 1210/Cr 1220 — هیچ 4000 (revenue دوباره ثبت نمی‌شود)
    const je = await transitionJe(checkId, "BOUNCED");
    expectBalanced(je);
    expect(je.lines.find((l) => l.account.code === "1210")?.debit).toBe(BigInt(amount));
    expect(je.lines.find((l) => l.account.code === "1220")?.credit).toBe(BigInt(amount));
    expect(je.lines.filter((l) => l.account.code === "4000")).toHaveLength(0);
    // AR همان ردیف → TRADE (بدون double-count)
    expect((await prisma.accountsReceivable.findUniqueOrThrow({ where: { id: ar.id } })).exposureType).toBe("TRADE");
    expect(await prisma.accountsReceivable.count({ where: { refType: "check", refId: checkId } })).toBe(1);
    // بانک دست‌نخورده (برگشت قبل از وصول)
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBefore);
    // duplicate bounce → INVALID + فقط یک سند
    await expect(checks.bounce({ checkId, idempotencyKey: `w3-${tag}-C-bnc2`, actorId: actor })).rejects.toThrow(BadRequestException);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${checkId}:BOUNCED` } })).toBe(1);
  });

  // ---------- Scenario D — received clear سپس bounce ----------

  it("Scenario D: RECEIVED → clear → bounce — clearing می‌ماند، chargeback درست، معین مشتری برمی‌گردد، double journal ممنوع", async () => {
    const { check, customer } = await makeReceivedCheck(500_000, 4);
    const ca = await prisma.customerAccount.findUniqueOrThrow({ where: { customerId: customer.id } });
    const outBefore = ca.outstanding;

    await checks.clear({ checkId: check.id, idempotencyKey: `w3-${tag}-D-clr`, actorId: actor });
    expect((await prisma.customerAccount.findUniqueOrThrow({ where: { id: ca.id } })).outstanding).toBe(outBefore - 500_000n);
    const projAfterClear = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;

    await matchCheckToStatement(check.id, 500_000, `سناریو D ${tag}`);
    await checks.bounce({ checkId: check.id, idempotencyKey: `w3-${tag}-D-bnc`, actorId: actor });

    // clearing قبلی باقی است + chargeback: بانک برگشته پایین، سند Dr 1210/Cr 1100 متوازن
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:CLEARED` } })).toBe(1);
    const je = await transitionJe(check.id, "BOUNCED");
    expectBalanced(je);
    expect(je.lines.find((l) => l.account.code === "1210")?.debit).toBe(500_000n);
    expect(je.lines.find((l) => l.account.code === "1100")?.credit).toBe(500_000n);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projAfterClear - 500_000n);
    // معین مشتری: مطالبه دوباره برگشته بالا
    expect((await prisma.customerAccount.findUniqueOrThrow({ where: { id: ca.id } })).outstanding).toBe(outBefore);
    // AR: ردیف CHECK تسویه‌شده (تاریخچه) + ردیف TRADE جدید باز
    expect(await prisma.accountsReceivable.count({ where: { refType: "check", refId: check.id, exposureType: "CHECK", state: "SETTLED" } })).toBe(1);
    expect(await prisma.accountsReceivable.count({ where: { refType: "check", refId: check.id, exposureType: "TRADE", state: "OPEN" } })).toBe(1);
    // double bounce ممنوع
    await expect(checks.bounce({ checkId: check.id, idempotencyKey: `w3-${tag}-D-bnc2`, actorId: actor })).rejects.toThrow(BadRequestException);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:BOUNCED` } })).toBe(1);
  });

  // ---------- STEP 6: all journals balanced ----------

  it("accounting: همهٔ سندهای check_transition این اجرا متوازن‌اند", async () => {
    const checkRows = await prisma.check.findMany({ where: { idempotencyKey: { startsWith: `w3-${tag}` } }, select: { id: true } });
    const jes = await prisma.journalEntry.findMany({
      where: { sourceType: "check_transition", OR: checkRows.map((c) => ({ sourceId: { startsWith: c.id } })) },
      include: { lines: true },
    });
    expect(jes.length).toBeGreaterThan(3);
    for (const je of jes) {
      const dr = je.lines.reduce((a, l) => a + l.debit, 0n);
      const cr = je.lines.reduce((a, l) => a + l.credit, 0n);
      expect(dr).toBe(cr);
    }
  });

  // ---------- STEP 7: treasury projection == GL delta ----------

  it("projection==GL: روی بانک ایزوله، هر اثر چک دقیقاً همان دلتای GL 1100 را دارد (drift دمو پنهان نمی‌شود)", async () => {
    const glBefore = await balanceOf("1100");
    const projBefore = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;
    const { check } = await makeReceivedCheck(320_000, 7);
    await checks.clear({ checkId: check.id, idempotencyKey: `w3-${tag}-p1`, actorId: actor });
    // بانک ایزوله: projection دقیقاً projBefore + 320k
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBefore + 320_000n);
    // دلتای GL == دلتای projection (drift قبلیِ seed در «دلتا» خنثی می‌شود؛ ریشه: سندهای demo — جداگانه گزارش شده)
    expect((await balanceOf("1100")) - glBefore).toBe(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance - projBefore,
    );
    // برگشت بعد از وصول: دلتای GL == −320k == دلتای projection
    const glAfterClear = await balanceOf("1100");
    await checks.bounce({ checkId: check.id, idempotencyKey: `w3-${tag}-p2`, actorId: actor });
    expect((await balanceOf("1100")) - glAfterClear).toBe(
      (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance - (projBefore + 320_000n),
    );
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBefore);
  });

  // ---------- STEP 8: outbox dispatch idempotency ----------

  it("outbox: dispatch تکراری idempotent است — consumer عملیات business را دوباره اجرا نمی‌کند", async () => {
    const { check } = await makeReceivedCheck(260_000, 6);
    await checks.clear({ checkId: check.id, idempotencyKey: `w3-${tag}-obx`, actorId: actor });
    const ev = await prisma.domainEventOutbox.findFirstOrThrow({ where: { name: "CheckCleared", payload: { path: ["checkId"], equals: check.id } as never } });

    // drain تا وقتی رویداد ما DISPATCHED شود
    let guard = 0;
    while (guard++ < 50) {
      const cur = await prisma.domainEventOutbox.findUnique({ where: { id: ev.id } });
      if (cur?.state === "DISPATCHED") break;
      await bus.drain();
    }
    expect((await prisma.domainEventOutbox.findUniqueOrThrow({ where: { id: ev.id } })).state).toBe("DISPATCHED");
    // consumer: دقیقاً یک notification با templateKey پایدار
    expect(await prisma.notification.count({ where: { templateKey: `check-cleared:${check.id}`, createdAt: { gte: testStart } } })).toBe(1);
    // drain دوباره — هیچ notification دوم و هیچ سند دوم (business op re-run نشد)
    await bus.drain();
    expect(await prisma.notification.count({ where: { templateKey: `check-cleared:${check.id}`, createdAt: { gte: testStart } } })).toBe(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:CLEARED` } })).toBe(1);
  });

  // ---------- STEP 9: RBAC ----------

  it("RBAC: بدون هویت → 401؛ هویت بدون مجوز → 403؛ گارد قبل از handler است (بدون mutation)", () => {
    const handler = () => undefined;
    Reflect.defineMetadata(PERMISSION_KEY, ["checks.clear"], handler);
    const guard = new PermissionsGuard(new Reflector());
    const ctxOf = (identity: unknown) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ adminIdentity: identity }) }),
        getHandler: () => handler,
      }) as never;

    expect(() => guard.canActivate(ctxOf(undefined))).toThrow(UnauthorizedException); // 401
    expect(() => guard.canActivate(ctxOf({ userId: "u1", permissions: ["checks.view"] }))).toThrow(ForbiddenException); // 403
    // با مجوز درست رد می‌شود
    expect(guard.canActivate(ctxOf({ userId: "u2", permissions: ["checks.view", "checks.clear"] }))).toBe(true);
  });
});
