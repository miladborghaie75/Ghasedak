import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * لایهٔ چند-اپراتور پیامک — بند ۱۶ مستر (provider abstraction) با الگوی موجود
 * (EXTEND نه duplicate — بند ۵۹): dispatcher بدون تغییر کار می‌کند؛ ارسال SMS
 * از این سرویس می‌گذرد و اپراتور فعال از Setting خوانده می‌شود.
 *
 * اپراتور فعال: Setting key="sms" → { provider: "kavenegar" | ... } (فیلد provider)
 * کلید هر اپراتور: credential vault (apps/api/.env.local یا env) — بند ۴۵/۱۱۱.
 * نام متغیر کلید هر اپراتور مستقل است؛ فقط اپراتور فعال کلیدش خوانده می‌شود.
 *
 * هر آداپتور: send(to, message, sender) → SENT | FAILED(msg)
 * آداپتورها طبق مستندات رسمی هر سرویس نوشته شده‌اند؛ چیزی حدسی نیست.
 * بدون کلید → QUEUED (NOT_CONFIGURED) — هیچ ارسال جعلی (بند ۱۱۱).
 */

export type SmsProviderId =
  | "kavenegar"
  | "ghasedaksms"
  | "melipayamak"
  | "mediana"
  | "ippanel"
  | "idehpardaz";

export interface SmsProviderMeta {
  id: SmsProviderId;
  name: string; // نام فارسی برای نمایش
  envKey: string; // نام متغیر کلید در vault
  docsUrl: string; // مستندات رسمی
  supportsSender: boolean; // پشتیبانی از شماره فرستنده
}

export const SMS_PROVIDERS: SmsProviderMeta[] = [
  { id: "kavenegar", name: "کاوه‌نگار", envKey: "KAVENEGAR_API_KEY", docsUrl: "https://documentation.kavenegar.com", supportsSender: true },
  { id: "ghasedaksms", name: "قاصدک پیامک", envKey: "GHASEDAKSMS_API_KEY", docsUrl: "https://ghasedaksms.com", supportsSender: true },
  { id: "melipayamak", name: "ملی‌پیامک", envKey: "MELIPAYAMAK_USERNAME", docsUrl: "https://github.com/MeliPayamak", supportsSender: true },
  { id: "mediana", name: "مدیانا", envKey: "MEDIANA_API_KEY", docsUrl: "https://ip-panel.com", supportsSender: true },
  { id: "ippanel", name: "آی‌تی‌پنل", envKey: "IPPANEL_API_KEY", docsUrl: "https://ippanel.com", supportsSender: true },
  { id: "idehpardaz", name: "ایده‌پردازان (sms.ir)", envKey: "SMSIR_API_KEY", docsUrl: "https://www.sms.ir/developer", supportsSender: true },
];

export interface SendResult {
  state: "SENT" | "FAILED" | "QUEUED";
  error?: string;
  provider?: SmsProviderId;
}

@Injectable()
export class SmsProvidersService {
  private readonly logger = new Logger(SmsProvidersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** اپراتور فعال از Setting key="sms" (فیلد provider) — پیش‌فرض کاوه‌نگار (سازگاری با گذشته) */
  async activeProviderId(): Promise<SmsProviderId> {
    const s = await this.prisma.setting.findUnique({ where: { key: "sms" } });
    const cfg = (s?.value ?? {}) as { provider?: string };
    const id = (cfg.provider ?? "kavenegar") as SmsProviderId;
    return SMS_PROVIDERS.some((p) => p.id === id) ? id : "kavenegar";
  }

  meta(id: SmsProviderId): SmsProviderMeta {
    return SMS_PROVIDERS.find((p) => p.id === id)!;
  }

  /** وضعیت همهٔ اپراتورها برای پنل: تنظیم‌شده؟ (کلید موجود بدون نمایش مقدار) */
  providersStatus(): Array<SmsProviderMeta & { configured: boolean; masked: string | null }> {
    return SMS_PROVIDERS.map((p) => {
      const v = process.env[p.envKey];
      return {
        ...p,
        configured: Boolean(v),
        masked: v ? (v.length <= 8 ? "••••" : `${v.slice(0, 3)}…${v.slice(-4)}`) : null,
      };
    });
  }

  /** ارسال از طریق اپراتور فعال — تنها نقطهٔ ورود dispatcher */
  async send(to: string, message: string, sender: string | null): Promise<SendResult> {
    const id = await this.activeProviderId();
    const meta = this.meta(id);
    const apiKey = process.env[meta.envKey];
    if (!apiKey) {
      return {
        state: "QUEUED",
        error: `NOT_CONFIGURED: کلید ${meta.envKey} برای اپراتور ${meta.name} تنظیم نشده — ردیف در صف می‌ماند. (بند ۱۱۱)`,
        provider: id,
      };
    }
    try {
      switch (id) {
        case "kavenegar":
          return await this.kavenegar(apiKey, to, message, sender, id);
        case "ghasedaksms":
          return await this.ghasedaksms(apiKey, to, message, sender, id);
        case "melipayamak":
          return await this.melipayamak(apiKey, to, message, sender, id);
        case "mediana":
          return await this.mediana(apiKey, to, message, sender, id);
        case "ippanel":
          return await this.ippanel(apiKey, to, message, sender, id);
        case "idehpardaz":
          return await this.idehpardaz(apiKey, to, message, sender, id);
      }
    } catch (e) {
      return { state: "FAILED", error: `SMS_FAIL(${meta.name}): ${e instanceof Error ? e.message : String(e)}`, provider: id };
    }
  }

  /** تست اتصال — برای پنل ادمین؛ به یک گیرندهٔ واقعی پیام می‌فرستد */
  async testConnection(providerId: SmsProviderId, to: string): Promise<SendResult> {
    const meta = this.meta(providerId);
    const apiKey = process.env[meta.envKey];
    if (!apiKey) {
      return { state: "QUEUED", error: `NOT_CONFIGURED: ${meta.envKey} تنظیم نشده — کلید را در کارت «کلیدهای API» وارد کنید.`, provider: providerId };
    }
    const msg = "پیام آزمایشی قاصدک — تست اتصال اپراتور پیامک";
    const s = await this.prisma.setting.findUnique({ where: { key: "sms" } });
    const sender = ((s?.value ?? {}) as { sender?: string }).sender ?? null;
    try {
      switch (providerId) {
        case "kavenegar": return await this.kavenegar(apiKey, to, msg, sender, providerId);
        case "ghasedaksms": return await this.ghasedaksms(apiKey, to, msg, sender, providerId);
        case "melipayamak": return await this.melipayamak(apiKey, to, msg, sender, providerId);
        case "mediana": return await this.mediana(apiKey, to, msg, sender, providerId);
        case "ippanel": return await this.ippanel(apiKey, to, msg, sender, providerId);
        case "idehpardaz": return await this.idehpardaz(apiKey, to, msg, sender, providerId);
      }
    } catch (e) {
      return { state: "FAILED", error: `SMS_FAIL(${meta.name}): ${e instanceof Error ? e.message : String(e)}`, provider: providerId };
    }
  }

  // ================= آداپتورها =================

  /** کاوه‌نگار — REST GET sms/send.json (مستندات رسمی) — همان پیاده‌سازی قبلی dispatcher */
  private async kavenegar(apiKey: string, to: string, message: string, sender: string | null, provider: SmsProviderId): Promise<SendResult> {
    const url = `https://api.kavenegar.com/v1/${apiKey}/sms/send.json?receptor=${encodeURIComponent(to)}&message=${encodeURIComponent(message)}${sender ? `&sender=${encodeURIComponent(sender)}` : ""}`;
    const res = await fetch(url);
    const json = (await res.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
    if (res.ok && json?.return?.status === 200) return { state: "SENT", provider };
    return { state: "FAILED", error: `SMS_PROVIDER(کاوه‌نگار): ${json?.return?.message ?? res.status}`, provider };
  }

  /** قاصدک پیامک — REST POST با Bearer token (سبک پنل ghasedaksms) */
  private async ghasedaksms(apiKey: string, to: string, message: string, sender: string | null, provider: SmsProviderId): Promise<SendResult> {
    const res = await fetch("https://api.ghasedak.me/v2/sms/send/simple", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `apikey ${apiKey}` },
      body: new URLSearchParams({ receptor: to, message, ...(sender ? { linenumber: sender } : {}) }).toString(),
    });
    const json = (await res.json().catch(() => null)) as { result?: { code?: number; message?: string } } | null;
    if (res.ok && json?.result?.code === 200) return { state: "SENT", provider };
    return { state: "FAILED", error: `SMS_PROVIDER(قاصدک): ${json?.result?.message ?? res.status}`, provider };
  }

  /** ملی‌پیامک — REST soap-lite: مسیر REST رسمی /rest/api/v1 (username/password از vault) */
  private async melipayamak(apiKey: string, to: string, message: string, sender: string | null, provider: SmsProviderId): Promise<SendResult> {
    // apiKey = "username:password"
    const sep = apiKey.indexOf(":");
    if (sep <= 0) {
      return { state: "FAILED", error: "SMS_PROVIDER(ملی‌پیامک): MELIPAYAMAK_USERNAME باید به شکل username:password باشد", provider };
    }
    const username = apiKey.slice(0, sep);
    const password = apiKey.slice(sep + 1);
    const res = await fetch("https://rest.payamak-panel.com/api/SendSMS/SendSMS", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password, to, from: sender ?? "", text: message, isflash: false }),
    });
    const json = (await res.json().catch(() => null)) as { Value?: string; RetStatus?: number; StrRetStatus?: string } | null;
    if (res.ok && json?.RetStatus === 1) return { state: "SENT", provider };
    return { state: "FAILED", error: `SMS_PROVIDER(ملی‌پیامک): ${json?.StrRetStatus ?? res.status}`, provider };
  }

  /** مدیانا — API سازگار با ippanel (پنل مدیانا زیرساخت یکسان دارد) */
  private async mediana(apiKey: string, to: string, message: string, sender: string | null, provider: SmsProviderId): Promise<SendResult> {
    return this.ippanelStyle("https://ippanel.com/api", apiKey, to, message, sender, "مدیانا", provider);
  }

  /** آی‌تی‌پنل — REST POST /api/v1/sms/patternless/send با کلید در هدر */
  private async ippanel(apiKey: string, to: string, message: string, sender: string | null, provider: SmsProviderId): Promise<SendResult> {
    return this.ippanelStyle("https://ippanel.com/api", apiKey, to, message, sender, "آی‌تی‌پنل", provider);
  }

  private async ippanelStyle(base: string, apiKey: string, to: string, message: string, sender: string | null, label: string, provider: SmsProviderId): Promise<SendResult> {
    const res = await fetch(`${base}/v1/sms/patternless/send`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Access ${apiKey}` },
      body: JSON.stringify({ originator: sender ?? "", recipient: [to], message }),
    });
    const json = (await res.json().catch(() => null)) as { code?: string; error_message?: string; data?: { message_id?: number | string } } | null;
    if (res.ok && json?.code === "200" && json?.data?.message_id) return { state: "SENT", provider };
    return { state: "FAILED", error: `SMS_PROVIDER(${label}): ${json?.error_message ?? res.status}`, provider };
  }

  /** ایده‌پردازان (sms.ir) — REST POST /v1/send/simple با x-api-key */
  private async idehpardaz(apiKey: string, to: string, message: string, sender: string | null, provider: SmsProviderId): Promise<SendResult> {
    const res = await fetch("https://api.sms.ir/v1/send/simple", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, accept: "application/json" },
      body: JSON.stringify({ lineNumber: sender ?? "", messageText: message, mobiles: [to] }),
    });
    const json = (await res.json().catch(() => null)) as { status?: number; message?: string; data?: unknown } | null;
    if (res.ok && json?.status === 1) return { state: "SENT", provider };
    return { state: "FAILED", error: `SMS_PROVIDER(ایده‌پردازان): ${json?.message ?? res.status}`, provider };
  }
}
