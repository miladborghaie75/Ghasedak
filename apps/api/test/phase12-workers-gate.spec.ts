/**
 * فاز ۱۲ (گام ۵) — گیت workerهای پس‌زمینه:
 * با GHASEDAK_WORKERS=off، onModuleInit هر سه سرویس تایمر نمی‌سازد
 * و drain/dispatchOnce دستی همچنان کار می‌کند (قابلیت اصلی حفظ است).
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { EventBusService } from "../src/events/event-bus.service";
import { NotificationDispatcherService } from "../src/events/notification-dispatcher.service";

jest.setTimeout(120_000);

describe("Phase 12 step 5 — background workers gate", () => {
  let prisma: PrismaService;
  const OLD_ENV = process.env;

  beforeAll(async () => {
    process.env = { ...OLD_ENV, GHASEDAK_WORKERS: "off" };
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    process.env = OLD_ENV;
    await prisma.$disconnect();
  });

  it("با WORKERS=off: هیچ تایمری استارت نمی‌شود ولی drain دستی هنوز کار می‌کند", async () => {
    const bus = new EventBusService(prisma);
    const dispatcher = new NotificationDispatcherService(prisma);

    bus.onModuleInit();
    dispatcher.onModuleInit();

    // دسترسی به timer خصوصی از طریق key casting — نباید ساخته شده باشد
    const busTimer = (bus as unknown as { timer: unknown }).timer;
    const dispatchTimer = (dispatcher as unknown as { timer: unknown }).timer;
    expect(busTimer).toBeNull();
    expect(dispatchTimer).toBeNull();

    // قابلیت اصلی دستی حفظ است: dispatchOnce بدون credential پاس خالی می‌دهد (بدون fake success)
    const r = await dispatcher.dispatchOnce(5);
    expect(r).toHaveProperty("sent");
    expect(r).toHaveProperty("failed");
    expect(r).toHaveProperty("notConfigured");

    bus.onModuleDestroy();
    dispatcher.onModuleDestroy();
  });

  it("پیش‌فرض (unset): تایمرها روشن می‌شوند", () => {
    delete process.env.GHASEDAK_WORKERS;
    const bus = new EventBusService(prisma);
    bus.onModuleInit();
    expect((bus as unknown as { timer: unknown }).timer).not.toBeNull();
    bus.onModuleDestroy();
  });
});
