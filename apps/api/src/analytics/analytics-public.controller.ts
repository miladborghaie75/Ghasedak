import { Body, Controller, Headers, Post } from "@nestjs/common";
import { ConsentService } from "./consent.service";
import { VisitsService } from "./visits.service";

/**
 * مسیر عمومی رضایت آنالیتیکس (گام ۱۵-۱) — فروشگاه از بنر خودش اینجا می‌زند.
 * هویت: sessionKey (همان توکن سبد که middleware فروشگاه می‌گذارد) — نه موبایل،
 * چون بازدید ناشناس هنوز شماره‌ای نداده است. CSRF همان double-submit سمت
 * پراکسی فروشگاه چک می‌شود (الگوی /api/checkout).
 */
@Controller("analytics")
export class AnalyticsPublicController {
  constructor(
    private readonly consent: ConsentService,
    private readonly visits: VisitsService,
  ) {}

  @Post("public/consent")
  async recordConsent(
    @Body()
    body: {
      sessionKey?: string;
      kind?: "ANALYTICS" | "COOKIES";
      granted?: boolean;
      source?: string;
    },
  ) {
    const sessionKey = String(body?.sessionKey ?? "");
    // همان چیزی که middleware فروشگاه می‌سازد: uuid — قل‌زدن به رشتهٔ دلخواه ممنوع
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionKey)) {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "شناسه نشست نامعتبر است." } };
    }
    if (body?.kind !== "ANALYTICS" && body?.kind !== "COOKIES") {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "نوع رضایت نامعتبر است." } };
    }
    if (typeof body?.granted !== "boolean") {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "مقدار رضایت نامعتبر است." } };
    }
    const source = String(body?.source ?? "storefront").slice(0, 60);
    await this.consent.upsertGuestConsent(sessionKey, body.kind, body.granted, source);
    return { ok: true };
  }

  /**
   * شمارش بازدید صفحه (گام ۱۵-۶) — همان قواعد مسیر رضایت:
   * sessionKey فقط توکن سبد middleware است؛ مسیر کوتاه‌تر از ۲۰۰ کاراکتر.
   * شمارش همیشه‌روشن است (D-5)؛ ولی بات‌ها و پینگ تکراریِ همان مسیر در
   * پنجرهٔ ۳۰ دقیقه شمرده نمی‌شوند (D-6) — پاسخ counted:false یعنی
   * «شمردیم نه» (بات/تکرار/خطا)، نه خطای درخواست.
   */
  @Post("public/visit")
  async recordVisit(
    @Body()
    body: { sessionKey?: string; path?: string },
    @Headers("user-agent") ua?: string,
  ) {
    const sessionKey = String(body?.sessionKey ?? "");
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(sessionKey)) {
      return { ok: false, error: { code: "VALIDATION_ERROR", message: "شناسه نشست نامعتبر است." } };
    }
    const path = String(body?.path ?? "/").slice(0, 200);
    const res = await this.visits.recordVisit(sessionKey, path, ua);
    return { ok: true, counted: res.counted, reason: res.reason ?? null };
  }
}
