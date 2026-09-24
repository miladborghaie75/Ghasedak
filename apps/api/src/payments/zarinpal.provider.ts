import { Injectable, Logger } from "@nestjs/common";
import type { PaymentProviderAdapter, PaymentRequestContext, PaymentRedirect } from "./provider";

/**
 * آداپتور زرین‌پال — PAY.Request/Verification v4 REST.
 * credential فقط از env (ZARINPAL_MERCHANT_ID)؛ بدون آن provider «Not Configured»
 * باقی می‌ماند و هرگز فعال نمی‌شود (بند ۱۱۱ — هیچ credential ساختگی).
 */
const API_BASE = process.env.ZARINPAL_API_BASE ?? "https://payment.zarinpal.com";

@Injectable()
export class ZarinpalProvider implements PaymentProviderAdapter {
  readonly code = "zarinpal";
  private readonly logger = new Logger(ZarinpalProvider.name);
  private readonly merchantId = process.env.ZARINPAL_MERCHANT_ID ?? "";

  isConfigured(): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.merchantId);
  }

  async requestPayment(ctx: PaymentRequestContext): Promise<PaymentRedirect> {
    if (!this.isConfigured()) {
      throw new Error("ZARINPAL_NOT_CONFIGURED: ZARINPAL_MERCHANT_ID env تنظیم نشده است.");
    }
    const res = await fetch(`${API_BASE}/api/v4/payment/request.json`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        merchant_id: this.merchantId,
        amount: ctx.amount * 10, // تومان → ریال (واحد زرین‌پال)
        description: ctx.description,
        callback_url: ctx.callbackUrl,
        ...(ctx.mobile ? { metadata: { mobile: ctx.mobile } } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: { authority?: string; code?: number }; errors?: { message?: string }[] | { message?: string } }
      | null;
    const authority = body?.data?.authority;
    if (!res.ok || !authority || (body?.data?.code !== 100 && body?.data?.code !== 101)) {
      const msg =
        (Array.isArray(body?.errors) ? body?.errors[0]?.message : (body?.errors as { message?: string })?.message) ??
        `HTTP ${res.status}`;
      this.logger.warn(`zarinpal request failed: ${msg}`);
      throw new Error(`ZARINPAL_REQUEST_FAILED: ${msg}`);
    }
    const gatewayBase = process.env.ZARINPAL_GATEWAY_BASE ?? `${API_BASE}/StartPay`;
    return { kind: "redirect", redirectUrl: `${gatewayBase}/${authority}`, authority };
  }

  async verify(ctx: { authority: string; amount: number }): Promise<
    { ok: true; refId: string; raw: unknown } | { ok: false; reason: string; raw: unknown }
  > {
    if (!this.isConfigured()) {
      return { ok: false, reason: "ZARINPAL_NOT_CONFIGURED", raw: null };
    }
    const res = await fetch(`${API_BASE}/api/v4/payment/verify.json`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        merchant_id: this.merchantId,
        amount: ctx.amount * 10,
        authority: ctx.authority,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => null)) as
      | { data?: { code?: number; ref_id?: number }; errors?: unknown }
      | null;
    const code = body?.data?.code;
    if (code === 100 || code === 101) {
      return { ok: true, refId: String(body?.data?.ref_id ?? ""), raw: body };
    }
    // 101 = قبلاً verify شده — به‌عنوان موفقِ idempotent با refId موجود نمی‌دانیم؛ شکست صریح می‌گیریم
    return { ok: false, reason: code == null ? "PROVIDER_ERROR" : `CODE_${code}`, raw: body };
  }
}
