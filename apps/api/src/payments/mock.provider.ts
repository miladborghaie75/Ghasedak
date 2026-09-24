import { Injectable, Logger } from "@nestjs/common";
import type { PaymentProviderAdapter, PaymentRequestContext, PaymentRedirect } from "./provider";

/**
 * Mock Provider — فقط برای development/test (بند ۱۱۱).
 * verify همانند زرین‌پال نتیجه callback (Status=OK/NOK) را سمت سرور resolve می‌کند.
 * در production هیچ‌وقت انتخاب نمی‌شود (PaymentsService فقط در غیر-production آن را ثبت می‌کند).
 */
@Injectable()
export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly code = "mock";
  private readonly logger = new Logger(MockPaymentProvider.name);
  /** وضعیت callback ثبت‌شده — dev-only state; در production وجود ندارد */
  private static readonly statuses = new Map<string, "OK" | "NOK">();

  async requestPayment(ctx: PaymentRequestContext): Promise<PaymentRedirect> {
    const authority = `MOCK-${ctx.attemptId}`;
    const orderHint = ctx.callbackUrl.includes("order=")
      ? `&order=${ctx.callbackUrl.split("order=")[1]?.split("&")[0] ?? ""}`
      : "";
    const redirectUrl = `/checkout/pay/mock?authority=${encodeURIComponent(authority)}&amount=${ctx.amount}${orderHint}`;
    this.logger.log(`mock payment requested: attempt=${ctx.attemptId} amount=${ctx.amount}`);
    return { kind: "redirect", redirectUrl, authority };
  }

  async verify(ctx: { authority: string; amount: number }): Promise<
    { ok: true; refId: string; raw: unknown } | { ok: false; reason: string; raw: unknown }
  > {
    if (!ctx.authority.startsWith("MOCK-")) {
      return { ok: false, reason: "AUTHORITY_UNKNOWN", raw: ctx };
    }
    const st = MockPaymentProvider.statuses.get(ctx.authority);
    if (st !== "OK") {
      return { ok: false, reason: st === "NOK" ? "PAYMENT_CANCELED_BY_USER" : "NO_CALLBACK", raw: ctx };
    }
    return { ok: true, refId: `MOCKRF-${ctx.authority.slice(-8)}`, raw: { authority: ctx.authority } };
  }

  /** ثبت وضعیت callback mock — فقط از registerCallback صدا زده می‌شود */
  static recordStatus(authority: string, status: string): void {
    if (!authority.startsWith("MOCK-")) return;
    MockPaymentProvider.statuses.set(authority, status === "OK" ? "OK" : "NOK");
  }
}
