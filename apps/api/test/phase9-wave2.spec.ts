/**
 * فاز ۹ — Wave 2: دامنهٔ چک کامل (STEP 14) روی rehearsal DB
 *
 * پوشش: lifecycle allow-list + CAS همزمانی + idempotency + حسابداری متوازن
 * (صدور/وصول/برگشت/ابطال) + برگشت قبل/بعد از وصول + effective-paid خرید +
 * مستقل‌بودن matching از clearing (Match ≠ Clear) + Reminder schedule/suppression.
 */
import { BadRequestException, ConflictException } from "@nestjs/common";
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

jest.setTimeout(90_000);

describe("Phase 9 Wave 2 — Check domain", () => {
  let prisma: PrismaService;
  let journal: JournalService;
  let checks: ChecksService;
  let reminders: ReminderService;
  let treasury: TreasuryService;
  let purchasing: PurchasingService;
  let pos: PosService;
  let bus: EventBusService;
  let actor: string;
  const tag = `w2${Date.now()}${Math.floor(Math.random() * 100000)}`;

  const day = (n: number) => new Date(Date.now() + n * 86_400_000);

  /** بانکی که service بدون treasuryBankAccountId انتخاب می‌کند — primaryBankAccount با همین ترتیب */
  const primaryBank = async () => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    return prisma.bankAccount.findFirstOrThrow({ where: { glAccountId: glBank.id, active: true }, orderBy: { name: "asc" } });
  };

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
  });

  afterAll(async () => {
    // پاک‌سازی فقط داده‌های این اجرا (tag-محور)
    const checksRows = await prisma.check.findMany({ where: { idempotencyKey: { startsWith: `w2-${tag}` } }, select: { id: true } });
    const checkIds = checksRows.map((c) => c.id);
    if (checkIds.length) {
      await prisma.checkTransition.deleteMany({ where: { checkId: { in: checkIds } } });
      await prisma.accountsReceivable.deleteMany({ where: { refType: "check", refId: { in: checkIds } } });
      await prisma.paymentSettlement.deleteMany({ where: { checkId: { in: checkIds } } }).catch(() => undefined);
      const posIds = (await prisma.posPayment.findMany({ where: { checkId: { in: checkIds } }, select: { invoiceId: true, id: true } }));
      if (posIds.length) {
        await prisma.posPayment.deleteMany({ where: { id: { in: posIds.map((p) => p.id) } } });
        const invIds = posIds.map((p) => p.invoiceId);
        await prisma.check.deleteMany({ where: { id: { in: checkIds } } });
        await prisma.posInvoiceItem.deleteMany({ where: { invoiceId: { in: invIds } } });
        await prisma.posInvoice.deleteMany({ where: { id: { in: invIds } } });
        await prisma.journalEntry.deleteMany({ where: { sourceType: "pos_invoice", sourceId: { in: invIds } } });
        // projection را هم برگردان (SALE حذف شده = موجودی برمی‌گردد)
        const removedMoves = await prisma.stockLedgerEntry.findMany({ where: { refType: "pos_invoice", refId: { in: invIds } }, select: { variantSku: true, qtyOut: true } });
        for (const m of removedMoves) {
          await prisma.productVariant.update({ where: { sku: m.variantSku }, data: { stockQty: { increment: m.qtyOut } } });
        }
        await prisma.stockLedgerEntry.deleteMany({ where: { refType: "pos_invoice", refId: { in: invIds } } });
      } else {
        await prisma.check.deleteMany({ where: { id: { in: checkIds } } });
      }
    }
    await prisma.reminder.deleteMany({ where: { relatedEntityType: "check", relatedEntityId: { in: checkIds.length ? checkIds : ["__none__"] } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: "check_transition", sourceId: { contains: tag } } }).catch(() => undefined);
    // purchase fixtures — همهٔ تامین‌کننده‌های tag-دار (چند sup با پسوند random می‌سازد)
    // ترتیب FK: check.supplierId → purchaseInvoice → supplierAccount → supplier
    const sups = await prisma.supplier.findMany({ where: { name: { contains: tag } }, select: { id: true } });
    for (const sup of sups) {
      await prisma.check.deleteMany({ where: { supplierId: sup.id } });
      const invoices = await prisma.purchaseInvoice.findMany({ where: { supplierId: sup.id }, select: { id: true } });
      for (const inv of invoices) {
        await prisma.purchasePayment.deleteMany({ where: { invoiceId: inv.id } });
        await prisma.accountsPayable.deleteMany({ where: { refType: "purchase_invoice", refId: inv.id } });
        await prisma.purchaseInvoiceItem.deleteMany({ where: { invoiceId: inv.id } });
        await prisma.purchaseInvoice.deleteMany({ where: { id: inv.id } });
      }
      await prisma.supplierAccount.deleteMany({ where: { supplierId: sup.id } });
      await prisma.supplier.deleteMany({ where: { id: sup.id } });
    }
    // customers/supplier accounts touched
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

  let customerSeq = 0;
  const makeCustomer = async () => {
    customerSeq += 1;
    const mobileTail = String((Date.now() + customerSeq * 7919) % 10_000_000).padStart(7, "0"); // 7 رقم — کل: ۱۱ رقم با ۰۹
    const c = await prisma.customer.create({ data: { mobile: `0914${mobileTail}`, name: `مشتری Wave2 ${tag}` } });
    return c;
  };

  const makeReceivedCheck = async (amount = 1_200_000, dueIn = 10) => {
    const c = await makeCustomer();
    // بانک خزانه‌داری صریح — تا projection وصول/برگشت قطعی روی همان بانک تست باشد
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.findFirstOrThrow({ where: { glAccountId: glBank.id, active: true }, orderBy: { name: "asc" } });
    const chk = await checks.create({
      direction: "RECEIVED",
      number: `CH-${tag}-${Math.floor(Math.random() * 100000)}`,
      bankName: "بانک تست Wave2",
      amount,
      dueDate: day(dueIn),
      customerId: c.id,
      idempotencyKey: `w2-${tag}-${c.id}`,
      actorId: actor,
      treasuryBankAccountId: bank.id,
    });
    return { check: chk, customer: c, bank };
  };

  const balanceOf = async (code: string) => {
    const s = await glSum(code);
    return s.debit - s.credit;
  };

  // ---------- STEP 1: lifecycle ----------

  it("lifecycle: transitionهای مجاز با CAS + audit؛ غیرمجاز → INVALID_TRANSITION", async () => {
    const { check } = await makeReceivedCheck();
    // RECEIVED → DEPOSITED (مجاز، بدون اثر مالی)
    const r1 = await checks.transition({ checkId: check.id, toStatus: "DEPOSITED", idempotencyKey: `w2-${tag}-t1`, actorId: actor });
    expect(r1.replayed).toBe(false);
    expect(r1.check.status).toBe("DEPOSITED");
    expect(r1.check.lifecycleVersion).toBe(1);
    // DEPOSITED → RECEIVED (عقب‌گرد) → رد
    await expect(checks.transition({ checkId: check.id, toStatus: "RECEIVED", idempotencyKey: `w2-${tag}-t2` })).rejects.toThrow(BadRequestException);
    // RECEIVED (دریافتی) → CANCELLED → رد (مسیر مستقیم ندارد)
    await expect(checks.transition({ checkId: check.id, toStatus: "CANCELLED", idempotencyKey: `w2-${tag}-t3` })).rejects.toThrow(BadRequestException);
    // تاریخچه: v0 + v1
    const transitions = await prisma.checkTransition.findMany({ where: { checkId: check.id }, orderBy: { version: "asc" } });
    expect(transitions.map((t) => t.version)).toEqual([0, 1]);
    expect(transitions[1].fromStatus).toBe("RECEIVED");
    expect(transitions[1].toStatus).toBe("DEPOSITED");
  });

  it("idempotency: کلید تکراری → همان transition قبلی (replay)، بدون رکورد دوم", async () => {
    const { check } = await makeReceivedCheck(500_000, 12);
    await checks.transition({ checkId: check.id, toStatus: "DEPOSITED", idempotencyKey: `w2-${tag}-idem`, actorId: actor });
    const r2 = await checks.transition({ checkId: check.id, toStatus: "DEPOSITED", idempotencyKey: `w2-${tag}-idem`, actorId: actor });
    expect(r2.replayed).toBe(true);
    expect(await prisma.checkTransition.count({ where: { checkId: check.id } })).toBe(2); // v0 + v1
    expect((await prisma.check.findUniqueOrThrow({ where: { id: check.id } })).lifecycleVersion).toBe(1);
  });

  it("concurrent transition: دو request همزمان → فقط یکی واقعی؛ دیگری CONCURRENT_TRANSITION", async () => {
    const { check } = await makeReceivedCheck(700_000, 14);
    const results = await Promise.allSettled([
      checks.transition({ checkId: check.id, toStatus: "DEPOSITED", idempotencyKey: `w2-${tag}-race-a`, actorId: actor }),
      checks.transition({ checkId: check.id, toStatus: "DEPOSITED", idempotencyKey: `w2-${tag}-race-b`, actorId: actor }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    expect(await prisma.checkTransition.count({ where: { checkId: check.id, toStatus: "DEPOSITED" } })).toBe(1);
    expect((await prisma.check.findUniqueOrThrow({ where: { id: check.id } })).lifecycleVersion).toBe(1);
    // فاز ۹ — Wave 3 (STEP 3): بازنده بعد از شکست CAS دوباره وضعیت را می‌خواند؛
    // اگر version توسط برنده عوض شده → CONCURRENT_MODIFICATION (Conflict)؛
    // اگر txها serialize شده باشند → INVALID_TRANSITION (BadRequest). پوشش قطعی هر شاخه
    // در phase9-wave3.spec انجام شده؛ اینجا فقط ردِ «مشخص» با exactly-1 گذار مهم است.
    expect([BadRequestException, ConflictException]).toContain(reason.constructor);
  });

  // ---------- STEP 2/5: accounting — clearing ----------

  it("clearing RECEIVED: Dr 1100/Cr 1220 متوازن + مانده بانک + تسویه AR CHECK؛ دوباره → INVALID_TRANSITION", async () => {
    const bankBefore = await balanceOf("1100");
    const chk1220Before = await balanceOf("1220");
    const { check, customer } = await makeReceivedCheck(900_000, 5);
    // AR CHECK ساخته شده (STEP 7) — موضع مشتری
    const ar = await prisma.accountsReceivable.findFirstOrThrow({ where: { refType: "check", refId: check.id, exposureType: "CHECK" } });
    expect(ar.state).toBe("OPEN");
    const bank = await primaryBank();
    const projBefore = bank.currentBalance;

    const r = await checks.clear({ checkId: check.id, idempotencyKey: `w2-${tag}-clr1`, actorId: actor });
    expect(r.check.status).toBe("CLEARED");

    // سند متوازن Dr 1100/Cr 1220
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "check_transition", sourceId: `${check.id}:CLEARED` }, include: { lines: { include: { account: true } } } });
    const dr = je.lines.filter((l) => l.debit > 0n).reduce((a, l) => a + l.debit, 0n);
    const cr = je.lines.filter((l) => l.credit > 0n).reduce((a, l) => a + l.credit, 0n);
    expect(dr).toBe(cr);
    expect(dr).toBe(900_000n);
    expect(je.lines.find((l) => l.account.code === "1100")?.debit).toBe(900_000n);
    expect(je.lines.find((l) => l.account.code === "1220")?.credit).toBe(900_000n);

    // projection بانک فقط همین‌جا بالا رفته
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBefore + 900_000n);
    // GL 1100 بالا / 1220 پایین / 1210 دست‌نخورده (بدون double-count revenue)
    expect(await balanceOf("1100")).toBe(bankBefore + 900_000n);
    expect(await balanceOf("1220")).toBe(chk1220Before - 900_000n);
    // 1210: سند فروش قبلی این اجرا ممکن است Cr داشته باشد — سند check_transition خودش متوازن است؛
    // درآمد double-count نشده (Cr 4000 سند فروش، نه اینجا). دلتای 1210 در این تست = صفر از سوی ما:
    // فقط AR CHECK→SETTLED اتفاق افتاده (جانبی)، هیچ خط 1210 در سند وصول نیست.
    const je1210 = je.lines.filter((l) => l.account.code === "1210");
    expect(je1210).toHaveLength(0); // سند وصول فقط 1100/1220 دارد — نه 1210 (بدون double-count)
    void customer;

    // AR CHECK تسویه + معین مشتری
    const arAfter = await prisma.accountsReceivable.findUniqueOrThrow({ where: { id: ar.id } });
    expect(arAfter.state).toBe("SETTLED");

    // clear دوم → رد (allow-list وضعیت پایانی را می‌بندد)
    await expect(checks.clear({ checkId: check.id, idempotencyKey: `w2-${tag}-clr2` })).rejects.toThrow(BadRequestException);
    // هیچ سند دومی برای وصول همان چک نیست
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:CLEARED` } })).toBe(1);
  });

  it("صدور/وصول چک صادره ISSUED: صدور Dr 2100/Cr 2110 بدون حرکت بانک؛ وصول Dr 2110/Cr 1100 با کاهش بانک", async () => {
    const apBefore = await balanceOf("2100");
    const opBefore = await balanceOf("2110");
    const bank = await primaryBank();
    const projBefore = bank.currentBalance;

    // فیکسچر فاکتور خرید مستقل
    const sup = await purchasing.createSupplier({ name: `تست-تامین-${tag}-${Math.floor(Math.random() * 100000)}`, actorId: actor });
    const invRow = await prisma.purchaseInvoice.create({
      data: {
        number: `PINV-W2-${tag}-${Math.floor(Math.random() * 100000)}`,
        supplierId: sup.id,
        state: "POSTED",
        subtotal: 800_000n,
        grandTotal: 800_000n,
        items: { create: [{ variantSku: (await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } })).sku, qty: 1, unitCost: 800_000n }] },
      },
      select: { id: true },
    });
    await prisma.accountsPayable.create({ data: { accountPId: (await prisma.supplierAccount.findUniqueOrThrow({ where: { supplierId: sup.id } })).id, refType: "purchase_invoice", refId: invRow.id, amount: 800_000n } });

    // پرداخت چکی — در همان لحظه بانک نباید کم شود
    const r = await purchasing.payInvoice({ invoiceId: invRow.id, amount: 500_000, method: "check", checkNumber: `CHP-${tag}`, checkBankName: "بانک تست صادره", checkDueDateDays: 20, actorId: actor });
    expect(r.checkId).toBeTruthy();
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projBefore); // بدون حرکت بانک

    // سند صدور: Dr 2100/Cr 2110
    const chkId = r.checkId!;
    const jeIssue = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "check_transition", sourceId: `${chkId}:ISSUED` }, include: { lines: { include: { account: true } } } });
    expect(jeIssue.lines.find((l) => l.account.code === "2100")?.debit).toBe(500_000n);
    expect(jeIssue.lines.find((l) => l.account.code === "2110")?.credit).toBe(500_000n);
    // balanceOf = debit − credit → Cr 2110 ماندهٔ دفتری را 500k کم می‌کند (بدهی بیشتر)
    expect(await balanceOf("2110")).toBe(opBefore - 500_000n);
    // Dr 2100 ماندهٔ دفتری را 500k زیاد می‌کند (بدهی از 2100 به 2110 منتقل شد)
    expect(await balanceOf("2100")).toBe(apBefore + 500_000n);

    // وصول چک صادره: Dr 2110/Cr 1100 + کاهش مانده بانک
    const projAtClear = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;
    await checks.clear({ checkId: chkId, idempotencyKey: `w2-${tag}-clr-issued`, actorId: actor });
    const jeClear = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "check_transition", sourceId: `${chkId}:CLEARED` }, include: { lines: { include: { account: true } } } });
    expect(jeClear.lines.find((l) => l.account.code === "2110")?.debit).toBe(500_000n);
    expect(jeClear.lines.find((l) => l.account.code === "1100")?.credit).toBe(500_000n);
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projAtClear - 500_000n);
  });

  // ---------- STEP 6: bounce ----------

  it("bounce قبل از وصول (RECEIVED): Dr 1210/Cr 1220 + AR CHECK→TRADE؛ duplicate ممنوع", async () => {
    const { check } = await makeReceivedCheck(600_000, 3);
    const ar = await prisma.accountsReceivable.findFirstOrThrow({ where: { refType: "check", refId: check.id, exposureType: "CHECK" } });
    const ar1210Before = await glSum("1210");

    const r = await checks.bounce({ checkId: check.id, idempotencyKey: `w2-${tag}-bounce1`, actorId: actor, reason: "کمبود موجودی" });
    expect(r.check.status).toBe("BOUNCED");
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "check_transition", sourceId: `${check.id}:BOUNCED` }, include: { lines: { include: { account: true } } } });
    expect(je.lines.find((l) => l.account.code === "1210")?.debit).toBe(600_000n);
    expect(je.lines.find((l) => l.account.code === "1220")?.credit).toBe(600_000n);
    const ar1210After = await glSum("1210");
    expect(ar1210After.debit - ar1210After.credit).toBe(ar1210Before.debit - ar1210Before.credit + 600_000n);
    // exposure جابه‌جا شده — همان ردیف، بدون ردیف دوم (بدون double-count)
    expect((await prisma.accountsReceivable.findUniqueOrThrow({ where: { id: ar.id } })).exposureType).toBe("TRADE");
    expect(await prisma.accountsReceivable.count({ where: { refType: "check", refId: check.id } })).toBe(1);
    // duplicate → رد
    await expect(checks.bounce({ checkId: check.id, idempotencyKey: `w2-${tag}-bounce2` })).rejects.toThrow(BadRequestException);
  });

  it("bounce بعد از وصول (RECEIVED): بانک برمی‌گردد بیرون + مطالبهٔ دوباره 1210", async () => {
    const bank = await primaryBank();
    const { check } = await makeReceivedCheck(400_000, 2);
    await checks.clear({ checkId: check.id, idempotencyKey: `w2-${tag}-c1`, actorId: actor });
    const projAfterClear = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;
    await checks.bounce({ checkId: check.id, idempotencyKey: `w2-${tag}-b1`, actorId: actor });
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projAfterClear - 400_000n);
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "check_transition", sourceId: `${check.id}:BOUNCED` }, include: { lines: { include: { account: true } } } });
    expect(je.lines.find((l) => l.account.code === "1210")?.debit).toBe(400_000n);
    expect(je.lines.find((l) => l.account.code === "1100")?.credit).toBe(400_000n);
    // هیچ سند دومی
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:BOUNCED` } })).toBe(1);
  });

  it("bounce چک صادره بعد از وصول: chargeback به بانک + بدهی تامین‌کننده برمی‌گردد", async () => {
    const bank = await primaryBank();
    const sup = await purchasing.createSupplier({ name: `تست-تامین-${tag}-${Math.floor(Math.random() * 100000)}`, actorId: actor });
    const invRow = await prisma.purchaseInvoice.create({
      data: { number: `PINV-W2-${tag}-b`, supplierId: sup.id, state: "POSTED", subtotal: 300_000n, grandTotal: 300_000n, items: { create: [{ variantSku: (await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } })).sku, qty: 1, unitCost: 300_000n }] } },
      select: { id: true },
    });
    await prisma.accountsPayable.create({ data: { accountPId: (await prisma.supplierAccount.findUniqueOrThrow({ where: { supplierId: sup.id } })).id, refType: "purchase_invoice", refId: invRow.id, amount: 300_000n } });
    const r = await purchasing.payInvoice({ invoiceId: invRow.id, amount: 300_000, method: "check", checkNumber: `CHB-${tag}`, checkBankName: "بانک تست صادره", checkDueDateDays: 15, actorId: actor });
    const chkId = r.checkId!;
    await checks.clear({ checkId: chkId, idempotencyKey: `w2-${tag}-cb`, actorId: actor });
    const projAtClear = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance;

    await checks.bounce({ checkId: chkId, idempotencyKey: `w2-${tag}-bb`, actorId: actor });
    // chargeback: بانک برمی‌گردد بالا
    expect((await prisma.bankAccount.findUniqueOrThrow({ where: { id: bank.id } })).currentBalance).toBe(projAtClear + 300_000n);
    // AP بازسازی شده (پرداخت چکیِ مرده از effective-paid خارج شد)
    const ap = await prisma.accountsPayable.findFirstOrThrow({ where: { refType: "purchase_invoice", refId: invRow.id } });
    expect(ap.paidAmount).toBe(0n);
    expect(ap.state).toBe("OPEN");
  });

  it("concurrent bounce: دو request همزمان → فقط یک سند برگشت", async () => {
    const { check } = await makeReceivedCheck(250_000, 4);
    const results = await Promise.allSettled([
      checks.bounce({ checkId: check.id, idempotencyKey: `w2-${tag}-cb1`, actorId: actor }),
      checks.bounce({ checkId: check.id, idempotencyKey: `w2-${tag}-cb2`, actorId: actor }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:BOUNCED` } })).toBeLessThanOrEqual(1);
  });

  // ---------- STEP 3: POS CHECK ----------

  it("POS CHECK: یکپارچه با CheckService — Check+AR+Transition+Outbox در همان tx؛ درآمد یک‌بار", async () => {
    // فیکسچر موجودی
    const whId = (await prisma.salesChannel.findUniqueOrThrow({ where: { slug: "pos" } })).defaultWarehouseId;
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { status: "PUBLISHED" }, select: { sku: true } });
    const ledger = await prisma.stockLedgerEntry.findFirst({ where: { warehouseId: whId!, variantSku: variant.sku } });
    if (!ledger) {
      const inv = new InventoryService(prisma, new InventorySettingsService(prisma));
      await inv.move({ warehouseId: whId!, variantSku: variant.sku, type: "ADJUSTMENT", qty: 10, unitCost: 100000n, refType: "manual", refId: tag, idempotencyKey: `w2-restock-${tag}`, actorId: actor });
    }
    const shift = await prisma.cashierShift.findFirst({ where: { userId: actor, state: "OPEN" } })
      ?? await pos.openShift({ userId: actor, registerName: `REG-${tag}`, openingCash: 0 });

    const customer = await makeCustomer();
    const ep = await new PricingService(prisma, bus).effectivePrice(variant.sku, "pos");
    const amount = Number(ep.salePrice ?? ep.price);
    const r = await pos.sale({
      shiftId: shift.id,
      lines: [{ sku: variant.sku, qty: 1 }],
      payments: [{ methodCode: "check", amount, checkNumber: `CHP-${tag}-pos`, bankName: "بانک تست", dueDateDays: 25 }],
      customerMobile: customer.mobile,
      customerName: customer.name ?? undefined,
      idempotencyKey: `w2-pos-${tag}`,
    }, actor);

    const invoice = await prisma.posInvoice.findUniqueOrThrow({ where: { id: r.id }, include: { payments: true } });
    const checkId = invoice.payments[0].checkId!;
    expect(checkId).toBeTruthy();
    const chk = await prisma.check.findUniqueOrThrow({ where: { id: checkId } });
    expect(chk.direction).toBe("RECEIVED");
    expect(chk.sourceType).toBe("pos_invoice");
    // CheckTransition v0 ثبت شده (دامنهٔ متمرکز)
    expect(await prisma.checkTransition.count({ where: { checkId, version: 0 } })).toBe(1);
    // AR CHECK — موضع مشتری پشت چک
    expect(await prisma.accountsReceivable.count({ where: { refType: "check", refId: checkId, exposureType: "CHECK", state: "OPEN" } })).toBe(1);
    // درآمد یک‌بار: سند فروش Cr 4000 یک‌بار؛ 1210 در سند فروش دخالتی ندارد
    const je = await prisma.journalEntry.findFirstOrThrow({ where: { sourceType: "pos_invoice", sourceId: invoice.id }, include: { lines: { include: { account: true } } } });
    const dr = je.lines.filter((l) => l.debit > 0n).reduce((a, l) => a + l.debit, 0n);
    const cr = je.lines.filter((l) => l.credit > 0n).reduce((a, l) => a + l.credit, 0n);
    expect(dr).toBe(cr);
    expect(je.lines.filter((l) => l.account.code === "4000")).toHaveLength(1);
    expect(je.lines.find((l) => l.account.code === "1220")?.debit).toBe(BigInt(amount));
    // هیچ AR TRADE بابت همین فاکتور ساخته نشده (double-count ممنوع)
    expect(await prisma.accountsReceivable.count({ where: { refType: "check", refId: checkId, exposureType: "TRADE" } })).toBe(0);
  });

  // ---------- STEP 9: Match ≠ Clear ----------

  it("Match ≠ Clear: تطبیق BankStatement به چک، lifecycle را تغییر نمی‌دهد", async () => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.create({ data: { id: `test-bank-${tag}-m2`, name: `بانک M2 ${tag}`, bankName: "بانک", accountNumber: "7", glAccountId: glBank.id, currentBalance: 0n } });
    const amount = 1_500_000 + (Date.now() % 100_000);
    await treasury.importStatements({ bankAccountId: bank.id, lines: [{ date: new Date().toISOString(), amount, description: "وصول چک" }], actorId: actor });
    const { check } = await makeReceivedCheck(amount, 1);
    // چک به‌عنوان candidate match می‌شود (manual match با sourceType=check)
    const stmt = await prisma.bankStatement.findFirstOrThrow({ where: { bankAccountId: bank.id, amount: BigInt(amount) } });
    await treasury.manualMatch(bank.id, stmt.id, "check", check.id, BigInt(amount), actor);
    // match رخ داده — اما lifecycle دست نخورده:
    expect((await prisma.check.findUniqueOrThrow({ where: { id: check.id } })).status).toBe("RECEIVED");
    expect(await prisma.checkTransition.count({ where: { checkId: check.id, toStatus: "CLEARED" } })).toBe(0);
    // هیچ سند وصولی هم ساخته نشده
    expect(await prisma.journalEntry.count({ where: { sourceType: "check_transition", sourceId: `${check.id}:CLEARED` } })).toBe(0);
    // حالا clearing صریح — فقط اینجا اثر مالی دارد
    await checks.clear({ checkId: check.id, idempotencyKey: `w2-${tag}-mclear`, actorId: actor });
    expect((await prisma.check.findUniqueOrThrow({ where: { id: check.id } })).status).toBe("CLEARED");
  });

  // ---------- STEP 10: Reminder ----------

  it("Reminder: 7/3/1/due/overdue + idempotency + suppression بعد از پایانی", async () => {
    const { check: c7 } = await makeReceivedCheck(100_000, 7);
    const { check: c3 } = await makeReceivedCheck(100_000, 3);
    const { check: c1 } = await makeReceivedCheck(100_000, 1);
    const { check: c0 } = await makeReceivedCheck(100_000, 0);
    const { check: co } = await makeReceivedCheck(100_000, -2);

    const r1 = await reminders.runDaily();
    expect(r1.created).toBeGreaterThanOrEqual(5); // D-7، D-3، D-1، DUE، OVERDUE
    // idempotent — اجرای دوباره هیچ ردیف تکراری نمی‌سازد
    const r2 = await reminders.runDaily();
    expect(r2.created).toBe(0);
    expect(await prisma.reminder.count({ where: { relatedEntityType: "check", relatedEntityId: { in: [c7.id, c3.id, c1.id, c0.id, co.id] } } })).toBe(5);

    // suppression: چک cleared → یادآورهای PENDING آینده‌اش لغو می‌شوند
    await checks.clear({ checkId: c7.id, idempotencyKey: `w2-${tag}-rem-clear`, actorId: actor });
    const r3 = await reminders.runDaily();
    expect(r3.cancelled).toBeGreaterThanOrEqual(1);
    expect(await prisma.reminder.count({ where: { relatedEntityId: c7.id, status: "PENDING" } })).toBe(0);

    // suppression بعد از bounce
    await checks.bounce({ checkId: co.id, idempotencyKey: `w2-${tag}-rem-bounce`, actorId: actor });
    await reminders.runDaily();
    expect(await prisma.reminder.count({ where: { relatedEntityId: co.id, status: "PENDING" } })).toBe(0);

    // چک‌های زنده یادآورشان سر جایش است
    expect(await prisma.reminder.count({ where: { relatedEntityId: c3.id, status: "PENDING" } })).toBe(1);
  });

  // ---------- STEP 11: outbox ----------

  it("Outbox: رویدادهای CheckCreated/CheckTransitioned/CheckCleared داخل تراکنش ثبت شده‌اند", async () => {
    const { check } = await makeReceivedCheck(150_000, 6);
    const created = await prisma.domainEventOutbox.findFirst({ where: { name: "CheckCreated", payload: { path: ["checkId"], equals: check.id } as never } });
    expect(created).toBeTruthy();
    await checks.clear({ checkId: check.id, idempotencyKey: `w2-${tag}-obx`, actorId: actor });
    const transitioned = await prisma.domainEventOutbox.findFirst({ where: { name: "CheckTransitioned", payload: { path: ["checkId"], equals: check.id } as never } });
    const cleared = await prisma.domainEventOutbox.findFirst({ where: { name: "CheckCleared", payload: { path: ["checkId"], equals: check.id } as never } });
    expect(transitioned).toBeTruthy();
    expect(cleared).toBeTruthy();
  });
});
