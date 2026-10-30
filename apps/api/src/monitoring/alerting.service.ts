import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { onAlert, type AlertPayload } from "./alert-bus";

/**
 * سرویس ارسال هشدار (گام ۲۳ — بستهٔ C — تصمیم #۷: بدون SaaS جدید).
 *
 * کانال‌ها (بازبینی‌شده: در Settings ادمین تنظیم تلگرام وجود ندارد و sms-providers
 * گزارش credit نمی‌دهد، پس):
 *  ۱) پیام‌رسان‌ها با env — تلگرام (`ALERT_TELEGRAM_*`) و بله (`ALERT_BALE_*`)،
 *     فراخوانی مستقیم API با fetch (بدون وابستگی جدید). ترتیب: تلگرام، بعد بله؛
 *     اگر هر دو ست باشند و اولی ناموفق بود، دومی امتحان می‌شود.
 *  ۲) اگر هیچ پیام‌رسانی ست نبود/ناموفق بود → ایمیل از همان SMTP تنظیمات
 *     notification-dispatcher (ردیف EMAIL در صف می‌رود و dispatcher می‌فرستد).
 *  ۳) هیچ‌کدام ست نیست (توسعه/تست) → dry-run: لاگ ساخت‌یافته؛ هیچ شبکه‌ای در کار نیست.
 *
 * طوفان‌گریزی در خودِ رأس (`alert-bus.ts`) است — هر نوع هشدار حداکثر یک‌بار در ۳۰ دقیقه.
 */
@Injectable()
export class AlertingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertingService.name);
  private off: (() => void) | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    this.off = onAlert((p) => {
      void this.deliver(p).catch((e) =>
        this.logger.error(`ارسال هشدار شکست خورد: ${e instanceof Error ? e.message : String(e)}`),
      );
    });
  }

  onModuleDestroy(): void {
    this.off?.();
    this.off = null;
  }

  /** ارسال واقعی یک هشدار — برای تست هم عمومی است */
  async deliver(p: AlertPayload): Promise<"SENT" | "QUEUED" | "DRY_RUN"> {
    const text = renderAlertText(p);
    // در تست هرگز ارسال واقعی نمی‌شود — حتی اگر env اشتباهاً ست باشد
    const allowNetwork = process.env.NODE_ENV !== "test";
    const channels = allowNetwork ? messengerChannels() : [];
    for (const ch of channels) {
      const ok = await ch.send(text).catch((e) => {
        this.logger.warn(`${ch.id} send failed: ${e instanceof Error ? e.message : String(e)}`);
        return false;
      });
      if (ok) {
        this.logger.log(JSON.stringify({ component: "alerting", status: "SENT", channel: ch.id, kind: p.kind }));
        return "SENT";
      }
    }
    if (channels.length) this.logger.warn("هیچ پیام‌رسانی جواب نداد — تلاش ایمیل (fallback)");
    // fallback ایمیل — همان SMTP تنظیمات notification-dispatcher؛ ردیف در صف می‌ماند
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    if (allowNetwork && host && user) {
      await this.prisma.notification
        .create({
          data: {
            channel: "EMAIL",
            templateKey: `alert:${p.kind}`,
            to: process.env.ALERT_EMAIL ?? user,
            payload: { message: text, kind: p.kind } as object,
          },
        })
        .catch(() => undefined);
      this.logger.log(JSON.stringify({ component: "alerting", status: "QUEUED", channel: "email", kind: p.kind }));
      return "QUEUED";
    }
    // dry-run — توسعه/تست بدون env (یا تست با env اشتباه): فقط لاگ ساخت‌یافته
    this.logger.warn(
      JSON.stringify({ component: "alerting", status: "DRY_RUN", kind: p.kind, message: p.message, detail: p.detail ?? {} }),
    );
    return "DRY_RUN";
  }

  private async sendTelegram(token: string, chat: string, text: string): Promise<boolean> {
    return postMessage(`https://api.telegram.org/bot${token}/sendMessage`, chat, text);
  }
}

/** کانال‌های پیام‌رسانی که همین حالا env دارند — ترتیب: تلگرام، بله */
function messengerChannels(): Array<{ id: "telegram" | "bale"; send: (text: string) => Promise<boolean> }> {
  const out: Array<{ id: "telegram" | "bale"; send: (text: string) => Promise<boolean> }> = [];
  const tgToken = process.env.ALERT_TELEGRAM_BOT_TOKEN;
  const tgChat = process.env.ALERT_TELEGRAM_CHAT_ID;
  if (tgToken && tgChat) {
    out.push({ id: "telegram", send: (t) => postMessage(`https://api.telegram.org/bot${tgToken}/sendMessage`, tgChat, t) });
  }
  const baleToken = process.env.ALERT_BALE_BOT_TOKEN;
  const baleChat = process.env.ALERT_BALE_CHAT_ID;
  if (baleToken && baleChat) {
    out.push({ id: "bale", send: (t) => postMessage(`https://tapi.bale.ai/bot${baleToken}/sendMessage`, baleChat, t) });
  }
  return out;
}

/** POST هم‌شکل تلگرام/بله: {chat_id, text} — پاسخ `ok` همان دو API است */
async function postMessage(url: string, chat: string, text: string): Promise<boolean> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!r.ok) return false;
  const body = (await r.json().catch(() => null)) as { ok?: boolean } | null;
  return body ? body.ok !== false : true;
}

/** متن هشدار — فارسی، کوتاه، با نوع و جزئیات کلیدی */
export function renderAlertText(p: AlertPayload): string {
  const lines = [`🚨 هشدار قاصدک — ${p.kind}`, p.message];
  if (p.detail) {
    for (const [k, v] of Object.entries(p.detail)) {
      if (v === undefined || v === null) continue;
      lines.push(`• ${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
    }
  }
  return lines.join("\n");
}
