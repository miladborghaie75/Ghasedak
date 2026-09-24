/**
 * PaymentProvider abstraction — بند ۱۵/۱۱۱: هر provider آداپتور مستقل؛
 * هیچ provider واقعی بدون credential فعال نمی‌شود و موفقیت جعلی وجود ندارد.
 */
export interface PaymentRequestContext {
  attemptId: string;
  amount: number; // تومان صحیح
  description: string;
  mobile?: string | null;
  callbackUrl: string;
}

export interface PaymentRedirect {
  kind: "redirect";
  redirectUrl: string;
  authority: string;
}

export interface PaymentProviderResult {
  provider: string;
}

export interface PaymentProviderAdapter {
  readonly code: string;
  /** درخواست پرداخت — پاسخ: URL هدایت + authority */
  requestPayment(ctx: PaymentRequestContext): Promise<PaymentRedirect>;
  /**
   * verify سمت سرور — تنها مرجع تایید پرداخت (بند ۷).
   * هرگز بر اساس callback موفق برنمی‌گردد؛ فقط پاسخ واقعی provider.
   */
  verify(ctx: { authority: string; amount: number }): Promise<
    | { ok: true; refId: string; raw: unknown }
    | { ok: false; reason: string; raw: unknown }
  >;
  /** بازپرداخت — اگر provider پشتیبانی کند */
  refund?(ctx: { authority: string; amount: number }): Promise<{ ok: boolean; refId?: string; reason?: string }>;
}
