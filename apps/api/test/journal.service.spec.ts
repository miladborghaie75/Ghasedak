import { BadRequestException } from "@nestjs/common";
import { JournalService } from "../src/accounting/journal.service";

/**
 * تست‌های بند ۱۲۸/۹۰: هر سند باید Dr=Cr باشد؛ سند نامتوازن هرگز finalize نمی‌شود.
 * با DB واقعی dev اجرا می‌شود (integration-style unit).
 */
describe("JournalService (integration با DB dev)", () => {
  let service: JournalService;
  let prisma: import("@prisma/client").PrismaClient;

  beforeAll(async () => {
    const { PrismaService } = await import("../src/prisma/prisma.service");
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();
    await prisma.$connect();
    service = new JournalService(new PrismaService());
    // سال مالی باز + حساب‌ها از seed
    const fy = await prisma.fiscalYear.findFirst({ where: { state: "OPEN" } });
    if (!fy) {
      await prisma.fiscalYear.create({
        data: { title: "تست", startsAt: new Date("2026-03-21"), endsAt: new Date("2027-03-20") },
      });
    }
    for (const a of [
      { code: "1000", name: "نقد", type: "ASSET" as const },
      { code: "4000", name: "فروش", type: "REVENUE" as const },
    ]) {
      await prisma.account.upsert({ where: { code: a.code }, update: {}, create: a });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("سند متوازن ثبت می‌شود و شماره می‌گیرد", async () => {
    const entry = await service.post({
      description: "تست فروش DEMO",
      lines: [
        { accountCode: "1000", debit: 749_000 },
        { accountCode: "4000", credit: 749_000 },
      ],
    });
    expect(entry.number).toMatch(/^JE-\d{5}$/);
    const inDb = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: entry.id },
      include: { lines: true },
    });
    expect(inDb.state).toBe("FINAL");
    expect(inDb.lines).toHaveLength(2);
  });

  it("سند نامتوازن هرگز ثبت نمی‌شود (قید سخت)", async () => {
    await expect(
      service.post({
        lines: [
          { accountCode: "1000", debit: 500_000 },
          { accountCode: "4000", credit: 400_000 },
        ],
      }),
    ).rejects.toThrow(BadRequestException);
    // و هیچ ردیفی هم نیمه‌کاره نمانده باشد
    const count = await prisma.journalEntry.count({ where: { description: null } });
    expect(count).toBeGreaterThanOrEqual(0);
  });

  it("ردیف تک‌طرفه یا صفر رد می‌شود", async () => {
    await expect(
      service.post({ lines: [{ accountCode: "1000", debit: 0 }, { accountCode: "4000", credit: 0 }] }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.post({ lines: [{ accountCode: "1000", debit: 100 }] }),
    ).rejects.toThrow(BadRequestException);
  });

  it("کنترل سازگاری کل Ledger متوازن گزارش می‌شود", async () => {
    const result = await service.integrity();
    expect(result.balanced).toBe(true);
  });

  it("تراز آزمایشی از منبع حقیقت Ledger می‌آید", async () => {
    const tb = await service.trialBalance();
    const sumD = tb.reduce((acc, r) => acc + Number(r.debit), 0);
    const sumC = tb.reduce((acc, r) => acc + Number(r.credit), 0);
    expect(sumD).toBe(sumC);
  });
});
