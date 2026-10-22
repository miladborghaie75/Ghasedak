import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

/**
 * GA4 Measurement Protocol — ارسال رویداد فقط از سرور (تصمیم D-3 گام ۱۵).
 *
 * چرا سرور: reload صفحه دوباره‌شماری نمی‌کند، adblock نمی‌بُرد و یک‌تایی
 * با تایید پرداخت تضمین می‌شود (finalizePaid فقط یک‌بار اجرا می‌شود —
 * verify روی attempt تاییدشده زود برمی‌گردد).
 *
 * خاموش صادقانه: بدون هر دو env هیچ درخواستی شبکی نمی‌رود و هیچ «ارسال شد»
 * جعلی ثبت نمی‌شود (همان قاعدهٔ بند ۱۱۱ برای SMS/ایمیل).
 *
 * GA4_MP_ENDPOINT فقط برای شاهد مکانیکی (گام ۱۵-۵) است؛ در production ست نمی‌شود.
 */
@Injectable()
export class MeasurementService {
  private readonly logger = new Logger(MeasurementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * شناسهٔ اندازه‌گیری سروری — اگر GA4_MEASUREMENT_ID ست نشده بود همان
   * مقدار NEXT_PUBLIC_ فروشگاه استفاده می‌شود (یک مقدار در یک فایل env، دو اپ).
   */
  private measurementId(): string {
    return process.env.GA4_MEASUREMENT_ID ?? process.env.NEXT_PUBLIC_GA4_MEASUREMENT_ID ?? "";
  }

  /** هر دو کلید لازم برای MP تنظیم شده؟ */
  isConfigured(): boolean {
    return Boolean(this.measurementId() && process.env.GA4_API_SECRET);
  }

  /**
   * رویداد purchase برای یک سفارش — کد/اقلام/ارز را خودش از DB می‌خواند
   * تا مسیر فراخوانی (finalizePaid) باریک بماند. هرگز throw نمی‌کند.
   */
  async sendPurchaseForOrder(orderId: string, amount: number): Promise<boolean> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          code: true,
          currency: true,
          items: { select: { titleSnapshot: true, qty: true, unitPrice: true } },
        },
      });
      if (!order) return false;
      return await this.sendPurchase({
        orderCode: order.code,
        amount,
        currency: order.currency,
        items: order.items.map((i) => ({
          item_id: i.titleSnapshot,
          item_name: i.titleSnapshot,
          quantity: i.qty,
          price: Number(i.unitPrice),
        })),
      });
    } catch (e) {
      this.logger.warn(`GA4 purchase: خواندن سفارش ${orderId} ناموفق — ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** ارسال واقعی MP — برمی‌گرداند که درخواست رفت یا ابزار خاموش بود */
  async sendPurchase(ev: {
    orderCode: string;
    amount: number;
    currency?: string;
    items?: Array<{ item_id: string; item_name: string; quantity: number; price?: number }>;
  }): Promise<boolean> {
    const measurementId = this.measurementId();
    const apiSecret = process.env.GA4_API_SECRET ?? "";
    if (!measurementId || !apiSecret) {
      // خاموش — درخواستی نمی‌رود؛ لاگ فقط یک‌بار در بوت (onModuleInit) کافی است
      return false;
    }
    const endpoint = process.env.GA4_MP_ENDPOINT ?? "https://www.google-analytics.com/mp/collect";
    // client_id برای MP الزامی است؛ شناسهٔ پایدارِ مشتق از کد سفارش — هیچ دادهٔ
    // شخصی (موبایل/آدرس) هرگز به GA4 نمی‌رود.
    const clientId = createHash("sha256").update(`ghasedak:${ev.orderCode}`).digest("hex").slice(0, 32);
    const body = {
      client_id: clientId,
      events: [
        {
          name: "purchase",
          params: {
            transaction_id: ev.orderCode,
            value: ev.amount,
            currency: ev.currency ?? "IRT",
            items: ev.items ?? [],
          },
        },
      ],
    };
    try {
      const url = `${endpoint}?measurement_id=${encodeURIComponent(measurementId)}&api_secret=${encodeURIComponent(apiSecret)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) {
        this.logger.warn(`GA4 MP HTTP ${res.status} برای سفارش ${ev.orderCode}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.warn(`GA4 MP ارسال ناموفق (${ev.orderCode}): ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  }

  /** وضعیت بوت — همان سبک isConfigured زرین‌پال */
  logBootStatus(): void {
    if (!this.isConfigured()) {
      this.logger.warn("GA4 Measurement Protocol NOT CONFIGURED — رویداد purchase سروری فعال نیست.");
    }
  }
}
