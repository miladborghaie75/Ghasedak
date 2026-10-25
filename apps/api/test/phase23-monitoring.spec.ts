/**
 * گام ۲۳ (بستهٔ C) — مانیتورینگ و هشدار.
 *
 * پذیرش:
 *  ۱) health با DB سبز → status "ok" (نه degraded)؛ با DB خراب (mock) → "degraded".
 *  ۲) health خراب شبیه‌سازی‌شده → رویداد هشدار ساخته می‌شود و در حالت dry-run
 *     فقط لاگ ساخت‌یافته ثبت می‌شود — بدون ارسال واقعی در تست.
 *  ۳) آستانهٔ ۵xx: از ۱۰ تا رد نمی‌شود؛ از ۱۱م فقط یک هشدار (طوفان‌گریز).
 *  ۴) heartbeat worker: پاس سالم → بدون هشدار؛ خطای worker → رویداد هشدار.
 */
import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { HealthService } from "../src/health/health.service";
import { HealthController } from "../src/health/health.controller";
import { HealthWatchService } from "../src/monitoring/health-watch.service";
import { AlertingService } from "../src/monitoring/alerting.service";
import { NotificationDispatcherService } from "../src/events/notification-dispatcher.service";
import { SmsProvidersService } from "../src/events/sms-providers.service";
import { onAlert, resetAlertBusForTests, emitAlert, type AlertPayload } from "../src/monitoring/alert-bus";
import { record5xx, current5xxCount, reset5xxForTests } from "../src/monitoring/http-5xx-counter";

jest.setTimeout(120_000);

/** ثبت شنوندهٔ تستی — برگرداندن آرایهٔ هشدارهای دریافتی + تابع پاک‌سازی */
function captureAlerts(): { got: AlertPayload[]; off: () => void } {
  const got: AlertPayload[] = [];
  const off = onAlert((p) => got.push(p));
  return { got, off };
}

describe("Phase 23 — مانیتورینگ و هشدار", () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    // لاگ‌های ساخت‌یافته در تست شلوغ نشود — فقط خطاها
    jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);
    prisma = new PrismaService();
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    resetAlertBusForTests();
    reset5xxForTests();
  });

  describe("۱) health — db تنها چک الزامی", () => {
    it("DB سبز → status: ok و نسخه/آپتایم گزارش می‌شود", async () => {
      const svc = new HealthService(prisma);
      const s = await svc.getStatus();
      expect(s.status).toBe("ok");
      expect(s.checks.db).toBe(true);
      expect(s.checks.api).toBe(true);
      expect(typeof s.version).toBe("string");
      expect(s.version).not.toBe("");
      expect(s.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it("DB خراب (mock خطای queryRaw) → status: degraded", async () => {
      const broken = {
        $queryRaw: async () => {
          throw new Error("db down");
        },
      } as unknown as PrismaService;
      const s = await new HealthService(broken).getStatus();
      expect(s.status).toBe("degraded");
      expect(s.checks.db).toBe(false);
    });

    it("controller همان پاسخ را با requestId برمی‌گرداند (GET /api/v1/health)", async () => {
      const ctl = new HealthController(new HealthService(prisma));
      const res = await ctl.get({ requestId: "req-test-1" } as never);
      expect(res.status).toBe("ok");
      expect(res.requestId).toBe("req-test-1");
    });
  });

  describe("۲) سرویس هشدار — dry-run بدون ارسال واقعی", () => {
    it("deliver در تست → DRY_RUN (هیچ شبکه‌ای در کار نیست)", async () => {
      const alerting = new AlertingService(prisma);
      const r = await alerting.deliver({ kind: "HEALTH_DOWN", message: "تست" });
      expect(r).toBe("DRY_RUN");
    });

    it("health خراب پشت‌سرهم → رویداد HEALTH_DOWN یک‌بار شلیک می‌شود (طوفان‌گریز)", async () => {
      const brokenHealth = {
        getStatus: async () => ({ status: "degraded" as const, checks: { api: true, db: false, redis: false, storage: false }, version: "t", uptimeSeconds: 0 }),
      } as unknown as HealthService;
      const watch = new HealthWatchService(brokenHealth);
      const { got, off } = captureAlerts();
      try {
        await watch.run(); // خرابی ۱ — هنوز هشدار نیست (پرش شبکه ممکن است)
        expect(got).toHaveLength(0);
        await watch.run(); // خرابی ۲ → هشدار
        expect(got).toHaveLength(1);
        expect(got[0].kind).toBe("HEALTH_DOWN");
        await watch.run(); // پنجرهٔ ۳۰ دقیقه سرکوب می‌کند — طوفان هشدار نمی‌سازد
        expect(got).toHaveLength(1);
      } finally {
        off();
      }
    });

    it("بدون شنونده (حالت واقعی تست) → emitAlert فقط لاگ dry-run می‌دهد و true برمی‌گرداند", () => {
      const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
      expect(emitAlert("DISK_HIGH", "تست dry-run", { usedPercent: 91 })).toBe(true);
      expect(warn).toHaveBeenCalled();
      const logged = String(warn.mock.calls[0][0]);
      expect(logged).toContain("DRY_RUN");
      expect(logged).toContain("DISK_HIGH");
    });
  });

  describe("۳) آستانهٔ ۵xx با پنجرهٔ لغزان", () => {
    it("۱۰ خطا → بدون هشدار؛ ۱۱م → دقیقاً یک هشدار؛ ادامه → سرکوب", () => {
      const { got, off } = captureAlerts();
      try {
        for (let i = 0; i < 10; i++) expect(record5xx()).toBe(i + 1);
        expect(got).toHaveLength(0);
        expect(record5xx()).toBe(11);
        expect(got).toHaveLength(1);
        expect(got[0].kind).toBe("HTTP_5XX_SPIKE");
        // ادامهٔ خطاها در همان پنجره → شمارنده بالا می‌رود ولی هشدار جدیدی عبور نمی‌کند
        expect(record5xx()).toBe(12);
        expect(got).toHaveLength(1);
        expect(current5xxCount()).toBe(12);
      } finally {
        off();
      }
    });
  });

  describe("۴) heartbeat worker اعلان‌ها", () => {
    it("پاس سالم → بدون هشدار و خروجی شمارش‌دار", async () => {
      const dispatcher = new NotificationDispatcherService(prisma, new SmsProvidersService(prisma));
      const { got, off } = captureAlerts();
      try {
        const r = await dispatcher.dispatchOnce(5);
        expect(typeof r.sent).toBe("number");
        expect(typeof r.failed).toBe("number");
        expect(got).toHaveLength(0);
      } finally {
        off();
      }
    });

    it("خطای worker (DB خراب) → رویداد WORKER_ERROR شلیک می‌شود", async () => {
      const brokenPrisma = {
        notification: {
          findMany: async () => {
            throw new Error("connection lost");
          },
        },
      } as unknown as PrismaService;
      const dispatcher = new NotificationDispatcherService(brokenPrisma, new SmsProvidersService(brokenPrisma));
      const { got, off } = captureAlerts();
      try {
        await expect(dispatcher.dispatchOnce()).rejects.toThrow("connection lost");
        expect(got).toHaveLength(1);
        expect(got[0].kind).toBe("WORKER_ERROR");
        expect(got[0].detail?.component).toBe("notification-dispatcher");
      } finally {
        off();
      }
    });
  });
});
