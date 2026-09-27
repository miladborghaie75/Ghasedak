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
    await prisma.bankStatementMatch.deleteMany({ where: { statement: { bankAccountId: { startsWith: "test-bank-" } } } });
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

  it("انتقال بین حساب‌های خزانه: یک سند، دو مانده، اتمیک — فیکسچر مستقل (بدون وابستگی به demo/seed balance)", async () => {
    // ایزولاسیون (Hardening Gate §3): هر دو حساب متعلق به همین تست‌اند و مانده‌شان خودش
    // با cashIn ساخته می‌شود — هیچ وابستگی به demo-cash-main یا ترتیب اجرای تست‌های دیگر.
    const glCash = await prisma.account.findUniqueOrThrow({ where: { code: "1000" } });
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const from = await prisma.cashAccount.create({
      data: { id: `test-cash-${tag}-x`, name: `صندوق تست ${tag} X`, kind: "cash", glAccountId: glCash.id },
    });
    const to = await prisma.bankAccount.create({
      data: { id: `test-bank-${tag}-x`, name: `بانک تست ${tag} X`, bankName: "بانک تست", accountNumber: "9", glAccountId: glBank.id },
    });

    const actor = await realActor();
    // موجودی اولیه صندوق مبدأ — با مسیر واقعی واریز (سند Dr 1000/Cr 3000)
    await treasury.cashIn({ accountId: from.id, amount: 70000, description: "شارژ اولیه فیکسچر انتقال", actorId: actor });

    const beforeCash = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: from.id } })).currentBalance;
    const beforeBank = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: to.id } })).currentBalance;

    const r = await treasury.transfer({ fromId: from.id, toId: to.id, amount: 70000, description: "نقد به بانک", actorId: actor });
    expect(r.ok).toBe(true);
    expect(r.number).toMatch(/^TRF/);

    const afterCash = (await prisma.cashAccount.findUniqueOrThrow({ where: { id: from.id } })).currentBalance;
    const afterBank = (await prisma.bankAccount.findUniqueOrThrow({ where: { id: to.id } })).currentBalance;
    expect(beforeCash - afterCash).toBe(70000n);
    expect(afterBank - beforeBank).toBe(70000n);

    // سند انتقال (GLهای متفاوت → سند دارد)
    const je = await prisma.journalEntry.count({ where: { sourceType: "treasury_transfer", sourceId: r.number! } });
    expect(je).toBe(1);

    // انتقال به خود → رد
    await expect(treasury.transfer({ fromId: from.id, toId: from.id, amount: 1000 })).rejects.toThrow();
  });

  it("مغایرت‌گیری بانک: import + autoMatch 0/1/N با پرداخت PAID — مبلغ یکتا (مقاوم به داده legacy)", async () => {
    const glBank = await prisma.account.findUniqueOrThrow({ where: { code: "1100" } });
    const bank = await prisma.bankAccount.create({
      data: { id: `test-bank-${tag}-m`, name: `بانک تست ${tag} M`, bankName: "بانک تست", accountNumber: "123", glAccountId: glBank.id },
    });

    // مبلغ یکتا per-run: هیچ attempt قدیمیِ دیگری در DB این مبلغ را ندارد →
    // candidate همیشه دقیقاً ۱ است، مستقل از ترتیب اجرا و داده‌های legacy مشترک.
    const uniqueAmount = 1_000_000 + (Date.now() % 900_000);

    const r = await treasury.importStatements({
      bankAccountId: bank.id,
      lines: [
        { date: new Date().toISOString(), amount: uniqueAmount, description: "ورودی درگاه" },
        { date: new Date().toISOString(), amount: -45000, description: "کارمزد" },
      ],
      actorId: await realActor(),
    });
    expect(r.count).toBe(2);

    // یک پرداخت PAID منطبق (مبلغ یکتا + بازه زمانی)
    const method = await prisma.paymentMethod.findFirstOrThrow({ where: { code: "online" } });
    const attempt = await prisma.paymentAttempt.create({
      data: {
        methodId: method.id,
        amount: BigInt(uniqueAmount),
        state: "PAID",
        idempotencyKey: `test-${tag}-m`,
        authority: `TEST-${tag}`,
        verifiedAt: new Date(),
      },
    });

    const m = await treasury.autoMatch(bank.id, await realActor());
    expect(m.matched).toBe(1); // دقیقاً ۱ — نه «حداقل ۱»
    expect(m.ambiguous).toBe(0);
    expect(m.unmatched).toBe(1); // فقط کارمزد منفی unmatched می‌ماند

    const stmt = await prisma.bankStatement.findFirstOrThrow({ where: { bankAccountId: bank.id, amount: BigInt(uniqueAmount) } });
    expect(stmt.matchedPaymentId).toBe(attempt.id);

    const detail = await treasury.listStatements(bank.id);
    expect(detail.reconciliation.statementCount).toBe(2);
    expect(detail.reconciliation.statement).toBe(String(uniqueAmount - 45000)); // uniqueAmount - 45000

    await prisma.paymentAttempt.delete({ where: { id: attempt.id } });
  });
});
