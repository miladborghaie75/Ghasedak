/**
 * فاز ۱۲ (گام ۶) — سخت‌سازی تست: سه سناریوی باقی‌ماندهٔ audit فاز ۱۱:
 *
 * 1) Suppression یادآور بعد از chargeback: چک CLEARED→BOUNCED
 *    باید یادآور PENDING آینده را لغو کند و دیگر یادآور جدید نسازد.
 * 2) همزمانی دو ترمینال روی یک PosTicket: optimistic locking — فقط یکی
 *    transition موفق؛ دیگری TICKET_VERSION_CONFLICT.
 * 3) ساختار chargeback: CLEARED→BOUNCED باید سند معکوس (بانک خارج، AR برگشت)
 *    و وضعیت terminal بسازد (الگوی موجود checks.service).
 */
import "reflect-metadata";
import { ConflictException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { ReminderService } from "../src/checks/reminder.service";
import { ChecksService } from "../src/checks/checks.service";
import { JournalService } from "../src/accounting/journal.service";
import { PosService } from "../src/pos/pos.service";

jest.setTimeout(180_000);

describe("Phase 12 step 6 — hardening scenarios", () => {
  let prisma: PrismaService;
  let reminder: ReminderService;
  let checks: ChecksService;
  let pos: PosService;
  let actor: string;
  const tag = `p12h${Date.now()}${Math.floor(Math.random() * 100000)}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    const journal = new JournalService(prisma);
    reminder = new ReminderService(prisma);
    checks = new ChecksService(prisma, journal);
    pos = new PosService(
      prisma,
      {} as never, // inventory در این spec استفاده نمی‌شود (ticket-only)
      journal,
      {} as never,
      {} as never,
      checks,
    );
    actor = (await prisma.user.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    // پاک‌سازی tag-محور
    const checkIds = (await prisma.check.findMany({ where: { number: { startsWith: `P12H-${tag}` } }, select: { id: true } })).map((c) => c.id);
    if (checkIds.length) {
      await prisma.reminder.deleteMany({ where: { relatedEntityType: "check", relatedEntityId: { in: checkIds } } });
      // ترتیب FK: اول CheckTransition (به journalEntry ارجاع دارد)، بعد JournalEntry، بعد AR، بعد Check
      await prisma.checkTransition.deleteMany({ where: { checkId: { in: checkIds } } });
      await prisma.journalEntry.deleteMany({ where: { sourceType: "check_transition", OR: checkIds.map((id) => ({ sourceId: { startsWith: id } })) } });
      await prisma.accountsReceivable.deleteMany({ where: { refType: "check", refId: { in: checkIds } } });
      await prisma.check.deleteMany({ where: { id: { in: checkIds } } });
    }
    await prisma.domainEventOutbox.deleteMany({ where: { name: "ReminderCreated", payload: { path: ["tag"], equals: tag } as never } }).catch(() => undefined);
    const ticketIds = (await prisma.posTicket.findMany({ where: { userId: actor, status: { in: ["OPEN", "HELD", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 5, select: { id: true } })).map((t) => t.id);
    if (ticketIds.length) {
      await prisma.posTicket.deleteMany({ where: { id: { in: ticketIds } } });
    }
    await prisma.$disconnect();
  });

  it("1) suppression: چک نزدیک سررسید یادآور می‌سازد؛ بعد از CLEARED→BOUNCED یادآور PENDING لغو و دیگر ساخته نمی‌شود", async () => {
    // چک دریافتی نزدیک سررسید (۳ روز بعد)
    const due = new Date(Date.now() + 3 * 86_400_000);
    const check = await prisma.check.create({
      data: {
        number: `P12H-${tag}-1`,
        bankName: "بانک تست",
        amount: 5_000_000n,
        dueDate: due,
        direction: "RECEIVED",
        status: "RECEIVED",
        issueDate: new Date(),
        idempotencyKey: `p12h-check-${tag}`,
      },
    } as never);

    // روز ۱: یادآور DUE ساخته می‌شود
    const day1 = await reminder.runDaily({ now: new Date() });
    expect(day1.created).toBeGreaterThanOrEqual(1);
    const remBefore = await prisma.reminder.findFirstOrThrow({
      where: { relatedEntityId: check.id, status: "PENDING" },
    });
    expect(remBefore).toBeTruthy();

    // وصول (CLEARED) — سپس chargeback (BOUNCED)
    await checks.transition({ checkId: check.id, toStatus: "CLEARED", actorId: actor, idempotencyKey: `p12h-clr-${tag}` });
    await checks.transition({ checkId: check.id, toStatus: "BOUNCED", actorId: actor, idempotencyKey: `p12h-bnc-${tag}` });

    // روز ۲: suppression — یادآور PENDING قبلی لغو؛ یادآور جدید برای چک terminal ساخته نمی‌شود
    await reminder.runDaily({ now: new Date(Date.now() + 86_400_000) });
    const pendingAfter = await prisma.reminder.findMany({
      where: { relatedEntityId: check.id, status: "PENDING" },
    });
    expect(pendingAfter.length).toBe(0);
    const anyAfter = await prisma.reminder.findMany({ where: { relatedEntityId: check.id } });
    expect(anyAfter.length).toBeGreaterThanOrEqual(1);
    expect(anyAfter.every((r) => r.status === "CANCELLED")).toBe(true);
  });

  it("2) concurrency: دو ترمینال روی یک PosTicket — فقط یکی HELD می‌شود؛ دیگری TICKET_VERSION_CONFLICT", async () => {
    const t = await pos.ticketCreate({ userId: actor });
    const results = await Promise.allSettled([
      pos.ticketTransition(t.id, { to: "HELD", expectedVersion: t.version, actorId: actor }),
      pos.ticketTransition(t.id, { to: "HELD", expectedVersion: t.version, actorId: actor }),
    ]);
    const okCount = results.filter((r) => r.status === "fulfilled").length;
    const err = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    expect(okCount).toBe(1);
    expect(err?.reason).toBeInstanceOf(ConflictException);
    // cleanup همین تیکت
    await prisma.posTicket.delete({ where: { id: t.id } });
  });

  it("3) chargeback accounting: CLEARED→BOUNCED سند متوازن می‌سازد و چک terminal است", async () => {
    const due = new Date(Date.now() + 2 * 86_400_000);
    const check = await prisma.check.create({
      data: {
        number: `P12H-${tag}-2`,
        bankName: "بانک تست",
        amount: 3_000_000n,
        dueDate: due,
        direction: "RECEIVED",
        status: "RECEIVED",
        issueDate: new Date(),
        idempotencyKey: `p12h-check2-${tag}`,
      },
    } as never);
    await checks.transition({ checkId: check.id, toStatus: "DEPOSITED", actorId: actor, idempotencyKey: `p12h-dep-${tag}` });
    await checks.transition({ checkId: check.id, toStatus: "CLEARED", actorId: actor, idempotencyKey: `p12h-clr2-${tag}` });
    await checks.transition({ checkId: check.id, toStatus: "BOUNCED", actorId: actor, idempotencyKey: `p12h-bnc2-${tag}` });

    const after = await prisma.check.findUniqueOrThrow({ where: { id: check.id } });
    expect(after.status).toBe("BOUNCED");

    // اسناد transitionها همه متوازن
    const entries = await prisma.journalEntry.findMany({
      where: { sourceType: "check_transition", sourceId: { startsWith: check.id } },
      include: { lines: true },
    });
    expect(entries.length).toBe(2); // فقط CLEARED و BOUNCED(chargeback) سند دارند — DEPOSITED بدون اثر مالی
    for (const e of entries) {
      const dr = e.lines.reduce((a, l) => a + (l.debit ?? 0n), 0n);
      const cr = e.lines.reduce((a, l) => a + (l.credit ?? 0n), 0n);
      expect(dr).toBe(cr);
    }
  });
});
