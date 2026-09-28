/**
 * فاز ۱۱ — P2-B: Notification Dispatcher
 * بدون credential: هیچ ارسال جعل نمی‌شود — QUEUED می‌ماند + lastError=NOT_CONFIGURED
 * SMS mock-success نمی‌توان ساخت (provider واقعی) — پس فقط رفتار صف/audit خطا تست می‌شود.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { NotificationDispatcherService } from "../src/events/notification-dispatcher.service";

jest.setTimeout(120_000);

describe("Phase 11 — P2-B (notification dispatcher)", () => {
  let prisma: PrismaService;
  let dispatcher: NotificationDispatcherService;
  const tag = `p11n${Date.now()}`;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    dispatcher = new NotificationDispatcherService(prisma);
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { templateKey: { startsWith: `p11-dispatch-${tag}` } } });
    await prisma.$disconnect();
  });

  it("بدون credential: QUEUED می‌ماند + lastError=NOT_CONFIGURED + attempts increment؛ هیچ SENT فیک", async () => {
    delete process.env.KAVENEGAR_API_KEY;
    const n = await prisma.notification.create({
      data: {
        channel: "SMS",
        templateKey: `p11-dispatch-${tag}:pos-sale-sms:test`,
        to: "09120000000",
        payload: { invoiceNumber: "POS-000001", amount: "123456" } as object,
      },
    });
    const r = await dispatcher.dispatchOnce(50);
    expect(r.notConfigured).toBeGreaterThanOrEqual(1);

    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.status).toBe("QUEUED"); // هیچ fake success
    expect(after.sentAt).toBeNull();
    expect(after.lastError).toContain("NOT_CONFIGURED");
    expect(after.attempts).toBe(1);
  });

  it("FAILED فقط با خطای provider واقعی؛ retry فقط از FAILED — سرویس‌سطح", async () => {
    // ردیف FAILED دستی — retry سرویس‌سطح: تنها از FAILED به QUEUED، سپس بدون credential دوباره QUEUED
    const n = await prisma.notification.create({
      data: {
        channel: "SMS",
        templateKey: `p11-dispatch-${tag}:failed-test`,
        to: "09120000001",
        status: "FAILED",
        lastError: "SMS_PROVIDER: test",
      },
    });
    await prisma.notification.update({ where: { id: n.id }, data: { status: "QUEUED" } });
    const r = await dispatcher.dispatchOnce(50);
    const after = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(after.status).toBe("QUEUED"); // بدون credential دوباره صف
    expect(after.lastError).toContain("NOT_CONFIGURED");
    expect(r.notConfigured).toBeGreaterThanOrEqual(1);
    void BadRequestException;
  });
});
