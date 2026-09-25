/**
 * درس ریسک ۶ (audit معماری): شکست سند حسابداری هرگز بی‌صدا swallow نمی‌شود.
 * postOrNotify:
 * 1) سند سالم → posted=true و ردیف واقعی JournalEntry
 * 2) سند با حساب ناموجود → posted=false + Notification(ADMIN) با جزئیات + AuditLog(accounting.post.failure)
 *    — هیچ exception به بیرون؛ عملیات اصلی (فروشنده‌ی سند) سر جایش می‌ماند
 * 3) نوتیف idempotent ساعتی — دوبار شکست مشابه در همان ساعت دوبار نوتیف نمی‌سازد
 * با DB واقعی dev.
 */
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";

describe("JournalService.postOrNotify (درس ریسک ۶)", () => {
  let prisma: PrismaService;
  let svc: JournalService;
  const testNotifKeys = "journal-fail:smoke-risk6:%";

  beforeAll(async () => {
    const { PrismaService } = await import("../src/prisma/prisma.service");
    prisma = new PrismaService();
    await prisma.$connect();
    svc = new JournalService(prisma);
    // سال مالی باز + حساب‌های تست
    const fy = await prisma.fiscalYear.findFirst({ where: { state: "OPEN" } });
    if (!fy) {
      await prisma.fiscalYear.create({ data: { title: "تست ریسک۶", startsAt: new Date("2026-03-21"), endsAt: new Date("2027-03-20") } });
    }
    await prisma.account.upsert({ where: { code: "1000" }, update: {}, create: { code: "1000", name: "نقد", type: "ASSET" } });
    await prisma.account.upsert({ where: { code: "4000" }, update: {}, create: { code: "4000", name: "فروش", type: "REVENUE" } });
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { templateKey: { startsWith: "journal-fail:smoke-risk6:" } } });
    await prisma.auditLog.deleteMany({ where: { action: "accounting.post.failure", entityId: { startsWith: "smoke-risk6" } } });
    await prisma.journalEntry.deleteMany({ where: { sourceType: "smoke-risk6" } });
    await prisma.$disconnect();
  });

  it("سند سالم → posted=true با شماره JE", async () => {
    const r = await svc.postOrNotify({
      description: "تست ریسک۶ — سند سالم",
      sourceType: "smoke-risk6",
      sourceId: "smoke-risk6-ok",
      lines: [
        { accountCode: "1000", debit: 5000 },
        { accountCode: "4000", credit: 5000 },
      ],
    });
    expect(r.posted).toBe(true);
    expect(r.number).toMatch(/^JE-/);
  });

  it("حساب ناموجود → posted=false + Notification(ADMIN) + AuditLog — بدون exception", async () => {
    const r = await svc.postOrNotify({
      description: "تست ریسک۶ — حساب غلط",
      sourceType: "smoke-risk6",
      sourceId: "smoke-risk6-fail",
      lines: [
        { accountCode: "9999", debit: 1000 },
        { accountCode: "1000", credit: 1000 },
      ],
    });
    expect(r.posted).toBe(false);
    expect(r.error?.code).toBe("ACCOUNT_NOT_FOUND");

    const notif = await prisma.notification.findFirst({
      where: { channel: "ADMIN", templateKey: { startsWith: "journal-fail:smoke-risk6:smoke-risk6-fail" } },
    });
    expect(notif).not.toBeNull();
    const payload = notif!.payload as { title?: string; code?: string; sourceType?: string };
    expect(payload.code).toBe("ACCOUNT_NOT_FOUND");
    expect(payload.title).toContain("شکست سند حسابداری");

    const audit = await prisma.auditLog.findFirst({
      where: { action: "accounting.post.failure", entityId: "smoke-risk6-fail" },
    });
    expect(audit).not.toBeNull();
    expect((audit!.newValues as { code?: string }).code).toBe("ACCOUNT_NOT_FOUND");
  });

  it("نوتیف شکست idempotent ساعتی — دوبار شکست مشابه = یک نوتیف", async () => {
    for (let i = 0; i < 2; i++) {
      await svc.postOrNotify({
        description: "تست ریسک۶ — تکراری",
        sourceType: "smoke-risk6",
        sourceId: "smoke-risk6-dup",
        lines: [
          { accountCode: "9999", debit: 1000 },
          { accountCode: "1000", credit: 1000 },
        ],
      });
    }
    const notifs = await prisma.notification.findMany({
      where: { channel: "ADMIN", templateKey: { startsWith: "journal-fail:smoke-risk6:smoke-risk6-dup" } },
    });
    expect(notifs).toHaveLength(1);
    // audit دائم است — هر شکست یک رکورد
    const audits = await prisma.auditLog.count({
      where: { action: "accounting.post.failure", entityId: "smoke-risk6-dup" },
    });
    expect(audits).toBe(2);
  });
});
