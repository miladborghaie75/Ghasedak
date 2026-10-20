/**
 * گام F0-5 (P1-1) — allowlist آدرس بازگشت درگاه.
 *
 * چه چیزی سنجیده می‌شود:
 *  ۱) نرمال‌سازی/اعتبارسنجی خالص: نسبی روی دامنهٔ مجاز resolve می‌شود؛
 *     مطلق فقط با origin مجاز؛ پروتکل-نسبی/اسکیم غیر http/javscript و دامنهٔ
 *     بیرونی رد می‌شوند؛ نبودِ پیکربندی = خطای روشن (نه عبور بی‌بررسی).
 *  ۲) پیامد واقعی در `PaymentsService.startOnlinePayment`: آدرس بیرونی رد
 *     می‌شود و **هیچ PaymentAttempt ساخته نمی‌شود**؛ آدرس نسبی همان چرخهٔ
 *     سالم را می‌سازد (attempt + REDIRECTED + redirectUrl درگاه).
 *
 * روی rehearsal اجرا می‌شود؛ سفارش تستی خودش را می‌سازد و پاک می‌کند.
 */
import "reflect-metadata";
import { PrismaService } from "../src/prisma/prisma.service";
import { JournalService } from "../src/accounting/journal.service";
import { InventoryService } from "../src/inventory/inventory.service";
import { InventorySettingsService } from "../src/inventory/inventory-settings.service";
import { TreasuryService } from "../src/treasury/treasury.service";
import { PaymentsService } from "../src/payments/payments.service";
import { ZarinpalProvider } from "../src/payments/zarinpal.provider";
import { MockPaymentProvider } from "../src/payments/mock.provider";
import { MeasurementService } from "../src/analytics/measurement.service";
import {
  allowedCallbackOrigins,
  normalizeOrigins,
  resolveCallbackUrl,
  DEFAULT_CALLBACK_PATH,
} from "../src/payments/callback-url";

jest.setTimeout(120_000);

const ALLOWED = "https://www.lebaszirghasedak.ir";
const ENV = { PAYMENT_CALLBACK_ORIGINS: ALLOWED } as NodeJS.ProcessEnv;

/** کد خطای ساخت‌یافتهٔ API (HttpExceptionFilter همین کد را به کلاینت می‌دهد) */
function errorCode(fn: () => unknown): string {
  try {
    fn();
    return "NO_THROW";
  } catch (e) {
    return (e as { response?: { code?: string } }).response?.code ?? "NO_CODE";
  }
}

describe("Phase 15 — allowlist آدرس بازگشت درگاه (F0-5)", () => {
  describe("۱) اعتبارسنجی خالص", () => {
    it("origin ها نرمال می‌شوند و ورودی نامعتبر حذف", () => {
      expect(normalizeOrigins("https://shop.example, https://shop.example/, bad, ftp://x.example")).toEqual([
        "https://shop.example",
      ]);
    });

    it("allowlist از PAYMENT_CALLBACK_ORIGINS و در نبودش از CORS_ORIGINS می‌آید", () => {
      expect(allowedCallbackOrigins({ PAYMENT_CALLBACK_ORIGINS: `${ALLOWED},https://lebaszirghasedak.ir` } as NodeJS.ProcessEnv)).toEqual([
        ALLOWED,
        "https://lebaszirghasedak.ir",
      ]);
      expect(allowedCallbackOrigins({ CORS_ORIGINS: "http://localhost:3111" } as NodeJS.ProcessEnv)).toEqual(["http://localhost:3111"]);
      expect(allowedCallbackOrigins({} as NodeJS.ProcessEnv)).toEqual([]);
    });

    it("آدرس نسبی روی دامنهٔ مجاز resolve می‌شود؛ خالی → مسیر پیش‌فرض", () => {
      expect(resolveCallbackUrl("/api/pay/callback", ENV)).toBe(`${ALLOWED}/api/pay/callback`);
      expect(resolveCallbackUrl("", ENV)).toBe(`${ALLOWED}${DEFAULT_CALLBACK_PATH}`);
      expect(resolveCallbackUrl(undefined, ENV)).toBe(`${ALLOWED}${DEFAULT_CALLBACK_PATH}`);
      // دامنه با حروف بزرگ/کوچک یکسان دیده می‌شود (origin نرمال‌سازی می‌شود)
      expect(resolveCallbackUrl("https://WWW.Lebaszirghasedak.IR/api/pay/callback", ENV)).toBe(`${ALLOWED}/api/pay/callback`);
    });

    it("آدرس مطلق خارج از فهرست مجاز رد می‌شود (فیشینگ/ریدایرکت باز)", () => {
      const cases = [
        "https://evil.example/cb", // دامنهٔ بیرونی
        "https://www.lebaszirghasedak.ir.evil.example/cb", // ترفند پسوند
        "//evil.example/cb", // پروتکل-نسبی
        "javascript:alert(1)",
        "data:text/html,<script>alert(1)</script>",
        "http://www.lebaszirghasedak.ir/cb", // اسکیم متفاوت = origin متفاوت
        "https://www.lebaszirghasedak.ir:8443/cb", // پورت متفاوت = origin متفاوت
        "not a url",
      ];
      for (const c of cases) {
        expect([c, errorCode(() => resolveCallbackUrl(c, ENV))]).toEqual([c, "CALLBACK_URL_NOT_ALLOWED"]);
      }
    });

    it("پیکربندی نبودِ allowlist → خطای روشن، نه عبور بی‌بررسی", () => {
      const empty = {} as NodeJS.ProcessEnv;
      expect(errorCode(() => resolveCallbackUrl("https://evil.example/cb", empty))).toBe("CALLBACK_ORIGIN_UNCONFIGURED");
      expect(errorCode(() => resolveCallbackUrl("", empty))).toBe("CALLBACK_ORIGIN_UNCONFIGURED");
      // حتی آدرس نسبی در نبود پیکربندی عبور نمی‌کند (base نامعلوم است)
      expect(errorCode(() => resolveCallbackUrl("/api/pay/callback", empty))).toBe("CALLBACK_ORIGIN_UNCONFIGURED");
    });
  });

  describe("۲) چرخهٔ واقعی پرداخت با DB", () => {
    let prisma: PrismaService;
    let payments: PaymentsService;
    let orderId = "";
    let methodId = "";
    const tag = `${Date.now().toString(36)}`;
    const badKey = `tst-cb-bad-${tag}`;
    const okKey = `tst-cb-ok-${tag}`;
    const previous = process.env.PAYMENT_CALLBACK_ORIGINS;

    beforeAll(async () => {
      prisma = new PrismaService();
      await prisma.$connect();
      const journal = new JournalService(prisma);
      const inventory = new InventoryService(prisma, new InventorySettingsService(prisma));
      payments = new PaymentsService(
        prisma,
        inventory,
        journal,
        new TreasuryService(prisma, journal),
        new ZarinpalProvider(),
        new MockPaymentProvider(),
        new MeasurementService(prisma),
      );
      payments.onModuleInit();

      const method = await prisma.paymentMethod.findFirstOrThrow({ where: { code: "online", active: true } });
      methodId = method.id;

      const order = await prisma.order.create({
        data: {
          code: `TST-CB-${tag.toUpperCase()}`,
          addressSnapshot: { province: "تهران", city: "تهران", address: "تست گارد بازگشت درگاه", plaque: "۱", postalCode: "1111111111" },
          subtotal: 100_000n,
          shippingCost: 0n,
          total: 100_000n,
          status: "PENDING",
          paymentStatus: "PENDING",
        },
      });
      orderId = order.id;
      process.env.PAYMENT_CALLBACK_ORIGINS = ALLOWED;
    });

    afterAll(async () => {
      await prisma.paymentAttempt.deleteMany({ where: { idempotencyKey: { in: [badKey, okKey] } } }).catch(() => undefined);
      await prisma.order.deleteMany({ where: { id: orderId } }).catch(() => undefined);
      if (previous === undefined) delete process.env.PAYMENT_CALLBACK_ORIGINS;
      else process.env.PAYMENT_CALLBACK_ORIGINS = previous;
      await prisma.$disconnect();
    });

    it("آدرس بازگشت بیرونی → رد و بدون هیچ attempt (هیچ ردیفی ساخته نمی‌شود)", async () => {
      await expect(
        payments.startOnlinePayment({
          orderId,
          methodId,
          idempotencyKey: badKey,
          callbackUrl: "https://evil.example/paid-ok",
        }),
      ).rejects.toMatchObject({ response: { code: "CALLBACK_URL_NOT_ALLOWED" } });
      expect(await prisma.paymentAttempt.count({ where: { idempotencyKey: badKey } })).toBe(0);
    });

    it("آدرس نسبی → همان چرخهٔ سالم (attempt + REDIRECTED + redirect درگاه)", async () => {
      const r = await payments.startOnlinePayment({
        orderId,
        methodId,
        idempotencyKey: okKey,
        callbackUrl: "/api/pay/callback",
      });
      expect(r.attemptId).toBeTruthy();
      expect(r.redirectUrl).toContain("/checkout/pay/mock");

      const attempt = await prisma.paymentAttempt.findUniqueOrThrow({ where: { idempotencyKey: okKey } });
      expect(attempt.state).toBe("REDIRECTED");
      expect(attempt.authority).toBe(`MOCK-${attempt.id}`);
      // سفارش نباید با یک start سالم تغییر وضعیت پرداخت بدهد (verify جای دیگری است)
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.paymentStatus).toBe("PENDING");
    });

    it("همان کلید idempotency با آدرس بیرونی هم رد می‌شود (گارد قبل از کش/ادامه)", async () => {
      await expect(
        payments.startOnlinePayment({ orderId, methodId, idempotencyKey: okKey, callbackUrl: "https://evil.example/paid-ok" }),
      ).rejects.toMatchObject({ response: { code: "CALLBACK_URL_NOT_ALLOWED" } });
    });
  });
});
