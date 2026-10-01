/**
 * موج ۲ — کارت واحد درگاه (زرین‌پال) و کلید API پیامک (الگوی یک‌کارت).
 * رفتار واقعی: ذخیرهٔ Merchant ID از کانال credentials (env.local — هرگز DB، هرگز
 * مقدار کامل در پاسخ)؛ تست اتصال بدون credential → REQUIRES_CREDENTIAL صریح (بند ۱۱۱)؛
 * وضعیت ماسک‌شده. ذخیرهٔ کلید اپراتور پیامک → envKey همان اپراتور + فعال‌شدن خودکار.
 * روی rehearsal اجرا می‌شود؛ ردیف‌های خودش را پاک می‌کند.
 */
import "reflect-metadata";
import { BadRequestException } from "@nestjs/common";
import { PrismaService } from "../src/prisma/prisma.service";
import { PaymentGatewayController } from "../src/admin/payment-gateway.controller";
import { ZarinpalProvider } from "../src/payments/zarinpal.provider";
import { CapabilitiesController } from "../src/admin/capabilities.controller";
import { CredentialsController } from "../src/admin/credentials.controller";
import { CredentialsService } from "../src/admin/credentials.service";
import { NotificationDispatcherService } from "../src/events/notification-dispatcher.service";
import { SmsProvidersService } from "../src/events/sms-providers.service";

jest.setTimeout(120_000);

describe("Phase 14 wave2 — payment gateway & sms key single cards", () => {
  let prisma: PrismaService;
  let gateway: PaymentGatewayController;
  let capabilities: CapabilitiesController;
  const envBackup: Record<string, string | undefined> = {};

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();
    gateway = new PaymentGatewayController(prisma, new ZarinpalProvider());
    const creds = new CredentialsService();
    capabilities = new CapabilitiesController(
      prisma,
      new NotificationDispatcherService(prisma, new SmsProvidersService(prisma)),
      new SmsProvidersService(prisma),
      creds,
    );
    envBackup.MID = process.env.ZARINPAL_MERCHANT_ID;
    envBackup.SANDBOX = process.env.ZARINPAL_SANDBOX;
    envBackup.KAV = process.env.KAVENEGAR_API_KEY;
  });

  afterAll(async () => {
    // env بازگردانی می‌شود — تست محیط را کثیف نمی‌گذارد
    if (envBackup.MID === undefined) delete process.env.ZARINPAL_MERCHANT_ID; else process.env.ZARINPAL_MERCHANT_ID = envBackup.MID;
    if (envBackup.SANDBOX === undefined) delete process.env.ZARINPAL_SANDBOX; else process.env.ZARINPAL_SANDBOX = envBackup.SANDBOX;
    if (envBackup.KAV === undefined) delete process.env.KAVENEGAR_API_KEY; else process.env.KAVENEGAR_API_KEY = envBackup.KAV;
    await prisma.$disconnect();
  });

  it("gateway status: بدون credential → configured=false و هیچ نشت مقدار", async () => {
    delete process.env.ZARINPAL_MERCHANT_ID;
    const r = (await gateway.status()) as { configured: boolean; masked: string | null; adapterActive: boolean; gateway: string };
    expect(r.gateway).toBe("zarinpal");
    expect(r.configured).toBe(false);
    expect(r.adapterActive).toBe(false);
    expect(r.masked).toBeNull();
  });

  it("gateway test بدون credential → REQUIRES_CREDENTIAL صریح (بدون فیک)", async () => {
    delete process.env.ZARINPAL_MERCHANT_ID;
    await expect(gateway.test()).rejects.toBeInstanceOf(BadRequestException);
    // status با MID معتبر ولی فرمت غلط: UUID نیست → configured=false (سخت‌گیری فرمت)
    process.env.ZARINPAL_MERCHANT_ID = "not-a-uuid";
    const st = (await gateway.status()) as { configured: boolean; merchantValid: boolean };
    expect(st.merchantValid).toBe(false);
    expect(st.configured).toBe(false);
    delete process.env.ZARINPAL_MERCHANT_ID;
  });

  it("gateway status با MID معتبر → configured + ماسک؛ adapterActive false چون env مقدار را همین‌جا می‌گذارد", async () => {
    process.env.ZARINPAL_MERCHANT_ID = "12345678-90ab-4cde-8f01-23456789abcd";
    const r = (await gateway.status()) as { configured: boolean; masked: string | null };
    expect(r.configured).toBe(true);
    expect(r.masked).toContain("…");
    expect(r.masked).not.toContain("90ab-4cde"); // کل هرگز کامل برنمی‌گردد
    delete process.env.ZARINPAL_MERCHANT_ID;
  });

  it("sms key save → envKey همان اپراتور نوشته/اعمال و اپراتور فعال می‌شود", async () => {
    process.env.KAVENEGAR_API_KEY = "test-wave2-key-1234";
    const r = (await capabilities.saveSmsProviderKey({ provider: "kavenegar", key: "wave2-kavenegar-key-9999" })) as { configured: boolean; masked: string | null; envKey: string };
    expect(r.envKey).toBe("KAVENEGAR_API_KEY");
    expect(process.env.KAVENEGAR_API_KEY).toBe("wave2-kavenegar-key-9999");
    expect(r.configured).toBe(true);
    expect(r.masked).not.toContain("wave2-kavenegar-key-9999");
    const s = await prisma.setting.findUnique({ where: { key: "sms" } });
    expect((s?.value as { provider?: string }).provider).toBe("kavenegar");
  });

  it("sms key save با اپراتور نامعتبر/کلید خالی → VALIDATION یا UNKNOWN", async () => {
    await expect(capabilities.saveSmsProviderKey({ provider: "nope", key: "x" })).rejects.toBeInstanceOf(BadRequestException);
    await expect(capabilities.saveSmsProviderKey({ provider: "kavenegar", key: "  " })).rejects.toBeInstanceOf(BadRequestException);
    await expect(capabilities.saveSmsProviderKey({ provider: "melipayamak", key: "no-colon-here" })).rejects.toMatchObject({ response: { code: "VALIDATION_ERROR" } });
  });
});
