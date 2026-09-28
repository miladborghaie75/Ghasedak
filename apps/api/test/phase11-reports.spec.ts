/**
 * فاز ۱۱ (P3) — گزارش‌های مالی: ترازنامه و گردش حساب
 * همه از JournalLine (منبع حقیقت)؛ هیچ محاسبه موازی UI.
 * ترازنامه باید توازن داشته باشد (دارایی = بدهی + سرمایه + سود جاری)
 * و گردش حساب باید با trial-balance هم‌خوان باشد.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";

jest.setTimeout(120_000);

// بازسازی منطق endpointها (کوئری مستقیم همان source of truth — JournalLine)
async function balanceSheet(prisma: PrismaService) {
  const accounts = await prisma.account.findMany();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const lines = await prisma.journalLine.findMany({ select: { accountId: true, debit: true, credit: true } });
  const nets: Record<string, bigint> = { ASSET: 0n, LIABILITY: 0n, EQUITY: 0n, REVENUE: 0n, COGS: 0n, EXPENSE: 0n };
  for (const l of lines) {
    const a = byId.get(l.accountId);
    if (!a) continue;
    const net = a.type === "ASSET" || a.type === "COGS" || a.type === "EXPENSE"
      ? (l.debit ?? 0n) - (l.credit ?? 0n)
      : (l.credit ?? 0n) - (l.debit ?? 0n);
    nets[a.type] = (nets[a.type] ?? 0n) + net;
  }
  const retained = (nets.REVENUE ?? 0n) - (nets.COGS ?? 0n) - (nets.EXPENSE ?? 0n);
  const assets = nets.ASSET ?? 0n;
  const liabilities = nets.LIABILITY ?? 0n;
  const equity = (nets.EQUITY ?? 0n) + retained;
  return { assets, liabilities, equity, retained, balanced: assets === liabilities + equity };
}

describe("Phase 11 P3 — financial reports", () => {
  let prisma: PrismaService;
  let journal: JournalService;
  const tag = `p11r${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    journal = new JournalService(prisma);
  });

  afterAll(async () => {
    await prisma.journalEntry.deleteMany({ where: { sourceType: "manual", description: { contains: tag } } });
    await prisma.$disconnect();
  });

  it("ترازنامه توازن دارد؛ سند دستی متوازن توازن ترازنامه را نمی‌شکند؛ گردش با ثبت جدید جلو می‌رود", async () => {
    const before = await balanceSheet(prisma);
    expect(before.balanced).toBe(true);

    // سند دستی متوازن (Dr 1000 / Cr 4000) — توازن ترازنامه حفظ می‌شود
    await journal.postManual({
      description: `تست ترازنامه ${tag}`,
      sourceType: "manual",
      actorId: (await prisma.user.findFirstOrThrow()).id,
      lines: [
        { accountCode: "1000", debit: 25_000 },
        { accountCode: "4000", credit: 25_000 },
      ],
    });
    const after = await balanceSheet(prisma);
    expect(after.balanced).toBe(true);
    expect(after.assets - before.assets).toBe(25_000n); // نقد بیشتر شد
    expect(after.retained - before.retained).toBe(25_000n); // درآمد بیشتر شد

    // گردش حساب: delta حساب نقد قبل/بعد از ثبت = دقیقاً 25,000 بدهکار (snapshot-محور تا full-suite هم isolate بماند)
    const turnoverSum = async (from: Date, to: Date) => {
      const rows = await prisma.journalLine.groupBy({
        by: ["accountId"],
        where: { entry: { date: { gte: from, lte: to } } },
        _sum: { debit: true, credit: true },
      });
      const cash = await prisma.account.findUniqueOrThrow({ where: { code: "1000" } });
      const r = rows.find((x) => x.accountId === cash.id);
      return (r?._sum.debit ?? 0n) - (r?._sum.credit ?? 0n);
    };
    const from = new Date(Date.now() - 3_600_000);
    const to = new Date(Date.now() + 3_600_000);
    const cashNetBefore = await turnoverSum(from, to);
    expect(await balanceSheet(prisma)).toBeDefined();
    await journal.postManual({
      description: `تست گردش ${tag}`,
      sourceType: "manual",
      actorId: (await prisma.user.findFirstOrThrow()).id,
      lines: [
        { accountCode: "1000", debit: 10_000 },
        { accountCode: "4000", credit: 10_000 },
      ],
    });
    const cashNetAfter = await turnoverSum(from, new Date(Date.now() + 3_600_000));
    expect(cashNetAfter - cashNetBefore).toBe(10_000n);
  });

  it("فاز ۱۲ (گام ۳): cash-flow — درآمد نقد سند دستی به inflow اضافه می‌شود؛ net = inflow − outflow", async () => {
    // snapshot قبل
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const to = new Date(Date.now() + 3_600_000);
    const sumCash = async () => {
      const rows = await prisma.journalLine.findMany({
        where: { entry: { date: { gte: yearStart, lte: to } } },
        select: { accountId: true, debit: true, credit: true },
      });
      const cashIds = new Set(
        (await prisma.account.findMany({ where: { code: { in: ['1000', '1100'] } } })).map((a) => a.id),
      );
      let inflow = 0n;
      let outflow = 0n;
      for (const l of rows) {
        if (!cashIds.has(l.accountId)) continue;
        const delta = (l.debit ?? 0n) - (l.credit ?? 0n);
        if (delta > 0n) inflow += delta; else outflow += -delta;
      }
      return { inflow, outflow };
    };
    const before = await sumCash();
    await journal.postManual({
      description: "تست cash-flow " + tag,
      sourceType: "manual",
      actorId: (await prisma.user.findFirstOrThrow()).id,
      lines: [
        { accountCode: '1000', debit: 7_000 },
        { accountCode: '4000', credit: 7_000 },
      ],
    });
    const after = await sumCash();
    expect(after.inflow - before.inflow).toBe(7_000n);
    expect(after.outflow).toBe(before.outflow);
  });
});
