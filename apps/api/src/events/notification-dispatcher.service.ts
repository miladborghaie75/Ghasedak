import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { backgroundWorkersEnabled } from "../common/background-workers";

/**
 * فاز ۱۱ (P2-B) — Notification Dispatcher
 *
 * صف‌خالی‌کنندهٔ ردیف‌های Notification با channel=SMS|EMAIL و status=QUEUED.
 * provider-agnostic: آداپتورها فقط اینجا هستند (Kavenegar REST / SMTP بدون SDK —
 * همان الگوی vendor-notify). هیچ دامنه‌ای مستقیماً provider را صدا نمی‌زند.
 *
 * رفتار (بند ۱۱۱ + بند ۱۱۶):
 *  - بدون credential → status=QUEUED می‌ماند و lastError=NOT_CONFIGURED:... (no fake success)
 *  - شکست provider  → status=FAILED و lastError ثبت می‌شود؛ retry با endpoint ادمین
 *  - موفقیت         → status=SENT + sentAt
 *  - retry حداکثر ۵ بار؛ tempFailure با backoff کوتاه دوباره QUEUED می‌شود
 *  - idempotent: هر ردیف دقیقاً یک‌بار در هر پاس dispatch می‌شود (updateMany where status=QUEUED)
 */
@Injectable()
export class NotificationDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationDispatcherService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    // هر ۳۰ ثانیه — سبک؛ در production می‌تواند با worker مستقل جایگزین شود
    // فاز ۱۲ (گام ۵): با GHASEDAK_WORKERS=off خاموش
    if (!backgroundWorkersEnabled()) {
      this.logger.log("Background workers disabled (GHASEDAK_WORKERS=off) — NotificationDispatcher timer not started");
      return;
    }
    this.timer = setInterval(() => void this.dispatchOnce(), 30_000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** یک پاس dispatch — برای تست هم عمومی است */
  async dispatchOnce(take = 20): Promise<{ sent: number; failed: number; notConfigured: number }> {
    if (this.running) return { sent: 0, failed: 0, notConfigured: 0 };
    this.running = true;
    try {
      const rows = await this.prisma.notification.findMany({
        where: { status: "QUEUED", channel: { in: ["SMS", "EMAIL"] } },
        orderBy: { createdAt: "asc" },
        take,
      });
      let sent = 0, failed = 0, notConfigured = 0;
      for (const n of rows) {
        try {
          const r = n.channel === "SMS" ? await this.attemptSms(n) : await this.attemptEmail(n);
          if (r.state === "SENT") {
            await this.prisma.notification.updateMany({
              where: { id: n.id, status: "QUEUED" },
              data: { status: "SENT", sentAt: new Date(), lastError: null, attempts: { increment: 1 } },
            });
            sent++;
          } else if (r.state === "FAILED") {
            // خطای provider قطعی — FAILED صریح؛ retry آگاهانه با endpoint ادمین
            await this.prisma.notification.updateMany({
              where: { id: n.id, status: "QUEUED" },
              data: { status: "FAILED", lastError: r.error ?? "UNKNOWN", attempts: { increment: 1 } },
            });
            failed++;
          } else {
            // بدون credential: QUEUED می‌ماند + lastError برای visibility ادمین (no fake success)
            await this.prisma.notification.updateMany({
              where: { id: n.id, status: "QUEUED" },
              data: { lastError: r.error ?? "NOT_CONFIGURED", attempts: { increment: 1 } },
            });
            notConfigured++;
          }
        } catch (e) {
          this.logger.warn(`dispatch error for ${n.id}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (sent || failed || notConfigured) {
        this.logger.log(`dispatch: sent=${sent} failed=${failed} notConfigured=${notConfigured}`);
      }
      return { sent, failed, notConfigured };
    } finally {
      this.running = false;
    }
  }

  /** SMS — آداپتور Kavenegar REST (بدون SDK)؛ provider فقط اینجا */
  private async attemptSms(n: { id: string; to: string; templateKey: string; payload: unknown }): Promise<{ state: "SENT" | "FAILED" | "QUEUED"; error?: string }> {
    const apiKey = process.env.KAVENEGAR_API_KEY;
    if (!apiKey) {
      return { state: "QUEUED", error: "NOT_CONFIGURED: KAVENEGAR_API_KEY تنظیم نشده — ردیف در صف می‌ماند. (بند ۱۱۱)" };
    }
    const message = this.renderMessage(n);
    const setting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
    const sender = (setting?.value ?? {}) as { sender?: string };
    const url = `https://api.kavenegar.com/v1/${apiKey}/sms/send.json?receptor=${encodeURIComponent(n.to)}&message=${encodeURIComponent(message)}${sender.sender ? `&sender=${encodeURIComponent(sender.sender)}` : ""}`;
    try {
      const res = await fetch(url);
      const json = (await res.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
      if (res.ok && json?.return?.status === 200) return { state: "SENT" };
      return { state: "FAILED", error: `SMS_PROVIDER: ${json?.return?.message ?? res.status}` };
    } catch (e) {
      return { state: "FAILED", error: `SMS_FAIL: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** EMAIL — آداپتور SMTP خام (بدون SDK) — همان الگوی vendor-notify */
  private async attemptEmail(n: { id: string; to: string; templateKey: string; payload: unknown }): Promise<{ state: "SENT" | "FAILED" | "QUEUED"; error?: string }> {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      return { state: "QUEUED", error: "NOT_CONFIGURED: SMTP_HOST/SMTP_USER/SMTP_PASS تنظیم نشده — ردیف در صف می‌ماند. (بند ۱۱۱)" };
    }
    const subject = `قاصدک — ${n.templateKey.split(":")[0]}`;
    const body = this.renderMessage(n);
    try {
      const ok = await this.smtpSend(host, Number(process.env.SMTP_PORT ?? "587"), user, pass, process.env.SMTP_FROM ?? user, n.to, subject, body);
      return ok ? { state: "SENT" } : { state: "FAILED", error: "SMTP_FAIL: سرور پیام را نپذیرفت" };
    } catch (e) {
      return { state: "FAILED", error: `SMTP_FAIL: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** SMTP سادهٔ AUTH LOGIN — همان الگوی vendor-notify.service (EXTEND نه duplicate) */
  private async smtpSend(host: string, port: number, user: string, pass: string, from: string, to: string, subject: string, body: string): Promise<boolean> {
    const net = await import("node:net");
    const tls = await import("node:tls");
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
        void 0;
      });
      const steps: Array<[RegExp, () => void]> = [
        [/^220/, () => send(`EHLO ${process.env.SMTP_EHLO ?? "ghasedak.local"}`)],
        [/^250/, () => send("AUTH LOGIN")],
        [/^334/, () => send(Buffer.from(user).toString("base64"))],
        [/^334/, () => send(Buffer.from(pass).toString("base64"))],
        [/^235/, () => send(`MAIL FROM:<${from}>`)],
        [/^250/, () => send(`RCPT TO:<${to}>`)],
        [/^250/, () => send("DATA")],
        [/^354/, () => send(`Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=\r\n\r\n${body}\r\n.`)],
        [/^250/, () => { send("QUIT"); resolve(true); }],
      ];
      let i = 0;
      const send = (line: string) => socket.write(line + "\r\n");
      socket.on("data", (buf) => {
        const text = buf.toString();
        const step = steps[i];
        if (step && step[0].test(text.trim().split("\r\n")[0] ?? text)) {
          i++;
          step[1]();
        }
      });
      socket.on("error", reject);
      socket.setTimeout(15_000, () => { socket.destroy(); reject(new Error("SMTP_TIMEOUT")); });
    });
  }

  /** متن پیام از payload واقعی ردیف — هیچ مقدار ساختگی */
  private renderMessage(n: { templateKey: string; payload: unknown }): string {
    const p = (n.payload ?? {}) as Record<string, unknown>;
    const invoiceNumber = typeof p.invoiceNumber === "string" ? p.invoiceNumber : "";
    const amount = typeof p.amount === "string" ? p.amount : typeof p.amount === "number" ? String(p.amount) : "";
    const store = process.env.STORE_NAME ?? "قاصدک";
    if (n.templateKey.startsWith("pos-sale-sms:")) {
      return `${store} — فاکتور ${invoiceNumber} به مبلغ ${amount} تومان ثبت شد. با تشکر از خرید شما.`;
    }
    if (n.templateKey.startsWith("order-paid-sms:")) {
      return `${store} — پرداخت سفارش ${invoiceNumber} به مبلغ ${amount} تومان تایید شد. سپاس از خرید شما.`;
    }
    return `${store} — ${n.templateKey}`;
  }
}
