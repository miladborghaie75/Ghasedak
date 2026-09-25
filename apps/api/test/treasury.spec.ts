/** فاز ۸ — خزانه: واریز/برداشت/انتقال اتمیک + مانده projection + مغایرت‌گیری (بند ۵۹–۶۲) */
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";
import { TreasuryService } from "../src/treasury/treasury.service";

describe("TreasuryService (فاز ۸)", () => {
  let prisma: PrismaService;
  let treasury: TreasuryService;
  const tag = `t${Date.now()}${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    treasury = new TreasuryService(prisma, new JournalService(prisma));
  });

  /** actorId باید کاربر واقعی باشد (FK روی JournalEntry.actorId) */
  const realActor = async (): Promise<string> => (await prisma.user.findFirstOrThrow()).id;

  afterAll(async () => {
    // پاک‌سازی کنترل‌شده — فقط داده‌های این تست
    await prisma.journalEntry.deleteMany({ where: { sourceType: { in: ["treasury_cash_in", "treasury_cash_out", "treasury_transfer", "bank_stmt_test"] } } });
    await prisma.bankStatement.deleteMany({ where: { bankAccountId: { startsWith: "test-bank-" } } });
    await prisma.cashAccount.deleteMany({ where: { name: { startsWith: `صندوق تست ${tag}` } } });
    await prisma.bankAccount.deleteMany({ where: { id: { startsWith: "test-bank-" } } });
    await prisma.$disconnect();
  });

  it("واریز/برداشت: مانده + سند اتمیک؛ مبلغ منفی/صفر رد می‌شود", async () => {
    // صندوق تستی مستقل روی GL 1000
    const glCash = await prisma.account.findUniqueOrThrow({ where: { code: "1000" } });
    const cash = await prisma.cashAccount.create({
      data: { id: `test-cash-${tag}`, name: `صندوق تست ${tag}`, kind: "cash", glAccountId: glCash.id },
    });

    const actor = await realActor();
    const in1 = await treasury.cashIn({ accountId: cash.id, amount: 500000, description: "واریز تست", actorId: actor });
    expect(in1.ok).toBe(true);
    expect(in1.number).toMatch(/^RCP/);
    const after = await prisma.cashAccount.findUniqueOrThrow({ where: { id: cash.id } });
    expect(after.currentBalance).toBe(500000n);

    const out1 = await treasury.cashOut({ accountId: cash.id, amount: 120000, description: "برداشت تست", actorId: actor });
    expect(out1.number).toMatch(/^PMT/);
    const after2 = await prisma.cashAccount.findUniqueOrThrow({ where: { id: cash.id } });
    expect(after2.currentBalance).toBe(380000n);

    // سند اتمیک با مانده
    const entries = await prisma.journalEntry.count({ where: { sourceType: { in: ["treasury_cash_in", "treasury_cash_out"] }, sourceId: cash.id } });
    expect(entries).toBe(2);

    await expect(treasury.cashIn({ accountId: cash.id, amount: 0 })).rejects.toThrow();
    await expect(treasury.cashIn({ accountId: cash.id, amount: -5 })).rejects.toThrow();
  });

  it("انتقال بین حساب‌های خزانه: یک سند، دو مانده، اتمیک", async () => {
    const glCash = await prisma.account.findUniqueOrThrow({ where: { code: "1000" } });
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const from = await prisma.cashAccount.findUnique({ where: { id: "demo-cash-main" } });
    if (!from) {
      // اگر seed DEMO اجرا نشده، حساب موقت بساز
      await prisma.cashAccount.create({ data: { id: "demo-cash-main", name: "صندوق فروشگاه (DEMO)", kind: "cash", glAccountId: glCash.id } });
    }
    if (!(await prisma.bankAccount.findUnique({ where: { id: "demo-bank-main" } }))) {
      await prisma.bankAccount.create({ data: { id: "demo-bank-main", name: "حساب جاری اصلی (DEMO)", bankName: "بانک (DEMO)", accountNumber: "0", glAccountId: glBank.id } });
    }

    const beforeCash = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } })).currentBalance;
    const beforeBank = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: "demo-bank-main" } })).currentBalance;

    const r = await treasury.transfer({ fromId: "demo-cash-main", toId: "demo-bank-main", amount: 70000, description: "نقد به بانک", actorId: await realActor() });
    expect(r.ok).toBe(true);
    expect(r.number).toMatch(/^TRF/);

    const afterCash = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: "demo-cash-main" } })).currentBalance;
    const afterBank = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: "demo-bank-main" } })).currentBalance;
    expect(beforeCash - afterCash).toBe(70000n);
    expect(afterBank - beforeBank).toBe(70000n);

    // سند انتقال (GLهای متفاوت → سند دارد)
    const je = await prisma.journalEntry.count({ where: { sourceType: "treasury_transfer", sourceId: r.number! } });
    expect(je).toBe(1);

    // انتقال به خود → رد
    await expect(treasury.transfer({ fromId: "demo-cash-main", toId: "demo-cash-main", amount: 1000 })).rejects.toThrow();
  });

  it("مغایرت‌گیری بانک: import + autoMatch با پرداخت PAID", async () => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.create({
      data: { id: `test-bank-${tag}`, name: `بانک تست ${tag}`, bankName: "بانک تست", accountNumber: "123", glAccountId: glBank.id },
    });

    const r = await treasury.importStatements({
      bankAccountId: bank.id,
      lines: [
        { date: new Date().toISOString(), amount: 1500000, description: "ورودی درگاه" },
        { date: new Date().toISOString(), amount: -45000, description: "کارمزد" },
      ],
      actorId: await realActor(),
    });
    expect(r.count).toBe(2);

    // یک پرداخت PAID منطبق (مبلغ + بازه زمانی)
    const method = await prisma.paymentMethod.findFirst({ where: { code: "online" } });
    const attempt = await prisma.paymentAttempt.create({
      data: {
        methodId: method!.id,
        amount: 1500000n,
        state: "PAID",
        idempotencyKey: `test-${tag}`,
        authority: `TEST-${tag}`,
        verifiedAt: new Date(),
      },
    });

    const m = await treasury.autoMatch(bank.id, await realActor());
    expect(m.matched).toBeGreaterThanOrEqual(1);

    const stmt = await prisma.bankStatement.findFirst({ where: { bankAccountId: bank.id, amount: 1500000n } });
    expect(stmt?.matchedPaymentId).toBe(attempt.id);

    const detail = await treasury.listStatements(bank.id);
    expect(detail.reconciliation.statementCount).toBe(2);
    expect(detail.reconciliation.statement).toBe("1455000"); // 1500000 - 45000

    await prisma.paymentAttempt.delete({ where: { id: attempt.id } });
  });
});
