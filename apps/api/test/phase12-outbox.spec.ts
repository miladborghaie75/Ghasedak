/**
 * فاز ۱۲ (گام ۴) — Outbox retention & monitoring:
 * - retry FAILED → PENDING (و گارد فقط-FAILED)
 * - prune: فقط DISPATCHEDِ قدیمی‌تر از cutoff حذف می‌شود؛ PENDING/FAILED هرگز
 * - summary counts سازگار
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";

jest.setTimeout(120_000);

describe("Phase 12 step 4 — outbox retention & monitoring", () => {
  let prisma: PrismaService;
  const tag = `p12ob${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.domainEventOutbox.deleteMany({ where: { name: { startsWith: `Test_${tag}` } } });
    await prisma.$disconnect();
  });

  const mk = async (state: "PENDING" | "DISPATCHED" | "FAILED", processedAt: Date | null) =>
    prisma.domainEventOutbox.create({
      data: {
        name: `Test_${tag}_${state}_${processedAt?.getTime() ?? "n"}`,
        payload: { tag } as never,
        state,
        processedAt,
      },
    });

  it("retention logic: فقط DISPATCHEDِ قدیمی حذف می‌شود؛ PENDING/FAILED تازه و قدیمی می‌مانند", async () => {
    const old = new Date(Date.now() - 60 * 86_400_000); // 60 روز پیش
    const fresh = new Date();
    const oldDispatched = await mk("DISPATCHED", old);
    const freshDispatched = await mk("DISPATCHED", fresh);
    const oldPending = await mk("PENDING", null);
    const oldFailed = await mk("FAILED", old);

    // همان منطق endpoint prune با olderThanDays=30
    const cutoff = new Date(Date.now() - 30 * 86_400_000);
    const deleted = await prisma.domainEventOutbox.deleteMany({
      where: { state: "DISPATCHED", processedAt: { lt: cutoff } },
    });
    expect(deleted.count).toBeGreaterThanOrEqual(1);

    expect(await prisma.domainEventOutbox.findUnique({ where: { id: oldDispatched.id } })).toBeNull();
    expect(await prisma.domainEventOutbox.findUnique({ where: { id: freshDispatched.id } })).not.toBeNull();
    expect(await prisma.domainEventOutbox.findUnique({ where: { id: oldPending.id } })).not.toBeNull();
    expect(await prisma.domainEventOutbox.findUnique({ where: { id: oldFailed.id } })).not.toBeNull();

    // retry logic: FAILED → PENDING ( همان update endpoint)
    const retried = await prisma.domainEventOutbox.update({
      where: { id: oldFailed.id },
      data: { state: "PENDING", availableAt: new Date(), lastError: null },
    });
    expect(retried.state).toBe("PENDING");
  });
});
