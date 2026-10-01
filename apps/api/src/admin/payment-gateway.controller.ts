import { BadRequestException, Body, Controller, Get, Inject, Post } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";
import { ZarinpalProvider } from "../payments/zarinpal.provider";

/**
 * کارت واحد درگاه پرداخت — فاز ۱۴ موج ۲.
 * تنها درگاه واقعاً پشتیبانی‌شده زرین‌پال است (Mock فقط dev — هرگز انتخاب‌شدنی نیست).
 * Merchant ID محرمانه است: از کانال credentials.controller (env/.env.local — هرگز DB)
 * ذخیره و فقط ماسک برمی‌گردد (بند ۴۵). تست اتصال به سندباکس واقعی زرین‌پال می‌زند؛
 * بدون credential → خطای صریح REQUIRES_CREDENTIAL، هیچ موفقیت جعلی (بند ۱۱۱).
 */

/** Merchant ID رشتهٔ UUID ۳۶ کاراکتری است — الگوی همان چیزی که provider قبول می‌کند */
const MERCHANT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * پایهٔ API زرین‌پال v4 — مسیر رسمی /pg/v4/... (کشف‌شده با پروب واقعی:
 * /api/v4 در سندباکس صفحهٔ مستندات HTML برمی‌گرداند، نه JSON).
 */
function zarinpalBase(): string {
  return process.env.ZARINPAL_SANDBOX === "false"
    ? "https://payment.zarinpal.com"
    : "https://sandbox.zarinpal.com";
}

function mask(v: string): string | null {
  return v.length <= 8 ? "••••" : `${v.slice(0, 6)}…${v.slice(-4)}`;
}

@Controller("admin/capabilities/payment-gateway")
export class PaymentGatewayController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ZarinpalProvider) private readonly zarinpal: ZarinpalProvider,
  ) {}

  /** وضعیت کارت: credential، پرچم sandbox/production، ردیف PaymentProvider و فعال‌بودن آداپتور */
  @Get("status")
  @RequirePermission("settings.view")
  async status() {
    const merchant = process.env.ZARINPAL_MERCHANT_ID || "";
    const providerRow = await this.prisma.paymentProvider.findFirst({ where: { provider: "zarinpal" } });
    const merchantValid = MERCHANT_RE.test(merchant);
    return {
      gateway: "zarinpal" as const,
      sandbox: process.env.ZARINPAL_SANDBOX !== "false",
      configured: Boolean(merchant) && merchantValid,
      merchantValid,
      masked: merchant ? mask(merchant) : null,
      providerRow: providerRow
        ? { id: providerRow.id, name: providerRow.name, env: providerRow.env, active: providerRow.active }
        : null,
      /** فعال به معنای آمادگی آداپتور در payments/start است */
      adapterActive: this.zarinpal.isConfigured(),
    };
  }

  /** تست اتصال واقعی — درخواست پرداخت آزمایشی سندباکس زرین‌پال (بدون ساخت Attempt سفارش) */
  @Post("test")
  @RequirePermission("settings.manage")
  async test() {
    const merchant = process.env.ZARINPAL_MERCHANT_ID || "";
    if (!merchant || !MERCHANT_RE.test(merchant)) {
      throw new BadRequestException({
        code: "REQUIRES_CREDENTIAL",
        message: "ZARINPAL_MERCHANT_ID تنظیم نشده یا فرمت UUID ندارد — Merchant ID را در همین کارت وارد کنید. (بند ۱۱۱)",
      });
    }
    const base = zarinpalBase();
    const res = await fetch(`${base}/pg/v4/payment/request.json`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        merchant_id: merchant,
        amount: 100_000, // ۱۰٬۰۰۰ تومان — مبلغ نمونهٔ تست اتصال
        description: "تست اتصال پنل قاصدک",
        callback_url: "https://example.invalid/ghasedak-payment-test",
        metadata: {},
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch((e) => {
      throw new BadRequestException({
        code: "GATEWAY_UNREACHABLE",
        message: `ارتباط با ${base} برقرار نشد: ${e instanceof Error ? e.message : String(e)}`,
      });
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: { authority?: string; code?: number }; errors?: Array<{ message?: string }> | { message?: string } }
      | null;
    const authority = body?.data?.authority;
    const ok = res.ok && Boolean(authority) && (body?.data?.code === 100 || body?.data?.code === 101);
    if (!ok) {
      const msg =
        (Array.isArray(body?.errors) ? body?.errors[0]?.message : (body?.errors as { message?: string } | null)?.message) ??
        `HTTP ${res.status}`;
      return {
        ok: false as const,
        endpoint: base,
        code: body?.data?.code ?? null,
        message: `زرین‌پال درخواست را نپذیرفت: ${msg}`,
      };
    }
    return {
      ok: true as const,
      endpoint: base,
      /** authority فقط نشانهٔ موفقیت تست است — سفارش واقعی نیست و Verify لازم ندارد */
      authorityMasked: `${String(authority).slice(0, 8)}…`,
    };
  }
}
