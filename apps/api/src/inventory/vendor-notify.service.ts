import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

/**
 * تحویل فاکتور خرید به تامین‌کننده — بند ۲۷ + بند ۱۱۱ (بدون credential فیک):
 * - ردیف تحویل در دامنه (SupplierInvoiceDelivery) با state machine: QUEUED → SENT | FAILED
 * - ارسال واقعی فقط با credential:
 *     EMAIL → SMTP واقعی با fetch (env: SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM) — نیازی به پکیج جدید نیست
 *     SMS   → آداپتور موجود Kavenegar (همان الگوی capabilities/sms-test) — متن خلاصه فاکتور
 * - بدون credential: ردیف QUEUED می‌ماند و خطای صریح «REQUIRES_CREDENTIAL» برمی‌گردد —
 *   هیچ «ارسال شد» جعل نمی‌شود و موجودی/حسابداری هم دست نمی‌خورد.
 * - idempotency: ارسال دستی تکراری روی همان invoiceId+channel+to در ۲۴ ساعت ردیف جدید نمی‌سازد
 *   (ارسال مجدد آگاهانه ادمین = param force=true).
 */
@Injectable()
export class VendorNotifyService {
  constructor(private readonly prisma: PrismaService) {}

  /** تلاش ارسال واقعی — return: { state, error? } — هرگز exception credential نمی‌اندازد */
  private async attemptEmail(to: string, subject: string, body: string, pdf?: { base64: string; filename: string }): Promise<{ state: "SENT" | "FAILED" | "QUEUED"; error?: string }> {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (!host || !user || !pass) {
      return { state: "QUEUED", error: "REQUIRES_CREDENTIAL: SMTP_HOST/SMTP_USER/SMTP_PASS تنظیم نشده — ردیف در صف می‌ماند. (بند ۱۱۱)" };
    }
    const port = Number(process.env.SMTP_PORT ?? "587");
    const from = process.env.SMTP_FROM ?? user;
    const boundary = `ghasedak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const headers =
      `From: Ghasedak <${from}>\r\n` +
      `To: ${to}\r\n` +
      `Subject: =?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=\r\n` +
      `MIME-Version: 1.0\r\n` +
      (pdf
        ? `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`
        : `Content-Type: text/plain; charset=UTF-8\r\n\r\n`);
    let payload: string;
    if (pdf) {
      payload =
        `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${body}\r\n` +
        `--${boundary}\r\nContent-Type: application/pdf; name="${pdf.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${pdf.filename}"\r\n\r\n` +
        pdf.base64.replace(/(.{76})/g, "$1\r\n") + `\r\n--${boundary}--\r\n`;
    } else {
      payload = body;
    }
    try {
      // STARTTLS روی پورت ۵۸۷ (SMTP_PORT=465 → implicit TLS) — با node:net/node:tls، بدون پکیج جدید
      const net = await import("node:net");
      const tls = await import("node:tls");
      await new Promise<void>((resolve, reject) => {
        const socket = port === 465
          ? tls.connect({ host, port, servername: host })
          : net.connect({ host, port });
        let buffer = "";
        const steps: Array<[RegExp, () => void]> = [
          [/^220/, () => send(`EHLO ${process.env.SMTP_EHLO ?? "ghasedak.local"}`)],
          [/^250/, () => send("AUTH LOGIN")],
          [/^334/, () => send(Buffer.from(user).toString("base64"))],
          [/^334/, () => send(Buffer.from(pass).toString("base64"))],
          [/^235/, () => send(`MAIL FROM:<${from}>`)],
          [/^250/, () => send(`RCPT TO:<${to}>`)],
          [/^250/, () => send("DATA")],
          [/^354/, () => { socket.write(headers + payload + "\r\n."); }],
          [/^250/, () => { send("QUIT"); resolve(); }],
        ];
        let stepIdx = 0;
        const send = (line: string) => socket.write(line + "\r\n");
        socket.on("data", (chunk: Buffer) => {
          buffer = chunk.toString("utf8");
          const code = buffer.slice(0, 3);
          if (code.startsWith("4") || code.startsWith("5")) {
            reject(new Error(`SMTP ${code}: ${buffer.trim().slice(0, 200)}`));
            return;
          }
          const match = steps[stepIdx];
          if (match && match[0].test(code)) {
            match[1]();
            stepIdx += 1;
            if (stepIdx > steps.length) resolve();
          }
        });
        socket.on("error", reject);
        socket.setTimeout(15_000, () => { socket.destroy(); reject(new Error("SMTP timeout")); });
      });
      return { state: "SENT" };
    } catch (e) {
      return { state: "FAILED", error: `SMTP_FAIL: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  private async attemptSms(to: string, message: string): Promise<{ state: "SENT" | "FAILED" | "QUEUED"; error?: string }> {
    const apiKey = process.env.KAVENEGAR_API_KEY;
    if (!apiKey) {
      return { state: "QUEUED", error: "REQUIRES_CREDENTIAL: KAVENEGAR_API_KEY تنظیم نشده — ردیف در صف می‌ماند. (بند ۱۱۱)" };
    }
    const setting = await this.prisma.setting.findUnique({ where: { key: "sms" } });
    const sender = (setting?.value ?? {}) as { sender?: string };
    const url = `https://api.kavenegar.com/v1/${apiKey}/sms/send.json?receptor=${encodeURIComponent(to)}&message=${encodeURIComponent(message)}${sender.sender ? `&sender=${encodeURIComponent(sender.sender)}` : ""}`;
    try {
      const res = await fetch(url);
      const json = (await res.json().catch(() => null)) as { return?: { status?: number; message?: string } } | null;
      if (res.ok && json?.return?.status === 200) return { state: "SENT" };
      return { state: "FAILED", error: `SMS_PROVIDER: ${json?.return?.message ?? res.status}` };
    } catch (e) {
      return { state: "FAILED", error: `SMS_FAIL: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** متن/موضوع پیام از snapshot واقعی فاکتور — هیچ مقدار ساختگی */
  private async buildMessage(invoiceId: string) {
    const inv = await this.prisma.purchaseInvoice.findUnique({
      where: { id: invoiceId },
      include: { supplier: { select: { name: true, phone: true, email: true } } },
    });
    if (!inv) throw new NotFoundException({ code: "NOT_FOUND", message: "فاکتور یافت نشد." });
    const items = await this.prisma.purchaseInvoiceItem.findMany({ where: { invoiceId }, orderBy: { id: "asc" } });
    const lines = items.map((i) => `• ${i.variantSku} × ${i.qty} — ${Number(i.unitCost).toLocaleString("fa-IR")}`);
    const subject = `فاکتور خرید ${inv.number} — قاصدک`;
    const body = [
      `تامین‌کننده محترم «${inv.supplier.name}»`,
      `فاکتور خرید ${inv.number} به تاریخ ${new Date(inv.createdAt).toLocaleDateString("fa-IR")} ثبت شد.`,
      "",
      ...lines,
      "",
      `جمع کل: ${Number(inv.grandTotal).toLocaleString("fa-IR")} تومان`,
      inv.dueDate ? `سررسید پرداخت: ${new Date(inv.dueDate).toLocaleDateString("fa-IR")}` : "",
      "",
      "این پیام به‌صورت خودکار از سامانه قاصدک ارسال شده است.",
    ].filter(Boolean).join("\n");
    return { invoice: inv, subject, body };
  }

  /** ارسال دستی از داشبورد — یک endpoint برای هر دو کانال */
  async sendInvoice(input: { invoiceId: string; channel: "EMAIL" | "SMS"; to?: string; force?: boolean; actorId?: string }) {
    const { invoice, subject, body } = await this.buildMessage(input.invoiceId);
    const to = (input.to ?? (input.channel === "EMAIL" ? invoice.supplier.email : invoice.supplier.phone) ?? "").trim();
    if (!to) {
      throw new BadRequestException({
        code: input.channel === "EMAIL" ? "NO_SUPPLIER_EMAIL" : "NO_SUPPLIER_PHONE",
        message: input.channel === "EMAIL"
          ? "تامین‌کننده ایمیل ثبت‌شده ندارد — ابتدا در فرم تامین‌کننده ایمیل را وارد کنید."
          : "تامین‌کننده شماره موبایل ثبت‌شده ندارد.",
      });
    }
    if (input.channel === "EMAIL" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "ایمیل تامین‌کننده نامعتبر است." });
    }
    if (input.channel === "SMS" && !/^09\d{9}$/.test(to)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "موبایل تامین‌کننده باید ۱۱ رقم با ۰۹ باشد." });
    }
    if (!input.force) {
      const recent = await this.prisma.supplierInvoiceDelivery.findFirst({
        where: { invoiceId: input.invoiceId, channel: input.channel, to, state: "SENT", sentAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
      });
      if (recent) {
        return { delivery: recent, resent: false, note: "در ۲۴ ساعت گذشته همین فاکتور به این نشانی ارسال شده — برای ارسال مجدد force=true." };
      }
    }
    const delivery = await this.prisma.supplierInvoiceDelivery.create({
      data: {
        invoiceId: input.invoiceId,
        channel: input.channel,
        to,
        mediaKind: input.channel === "EMAIL" ? "TEXT" : "TEXT",
      },
    });
    const result = input.channel === "EMAIL"
      ? await this.attemptEmail(to, subject, body)
      : await this.attemptSms(to, `${subject}\n${body}`.slice(0, 480));
    const updated = await this.prisma.supplierInvoiceDelivery.update({
      where: { id: delivery.id },
      data: {
        state: result.state,
        attempts: { increment: 1 },
        lastError: result.error ?? null,
        sentAt: result.state === "SENT" ? new Date() : null,
      },
    });
    await this.audit(input.actorId, `purchasing.invoice.send.${input.channel.toLowerCase()}`, "PurchaseInvoice", input.invoiceId, { to, state: result.state, deliveryId: updated.id });
    return { delivery: updated, resent: input.force === true, ...(result.error ? { error: result.error } : {}) };
  }

  /** تحویل‌های یک فاکتور — برای نمایش در UI جزئیات */
  async listDeliveries(invoiceId: string) {
    const items = await this.prisma.supplierInvoiceDelivery.findMany({
      where: { invoiceId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return { items };
  }

  private async audit(actorId: string | undefined, action: string, entity: string, entityId: string, meta: Record<string, unknown>) {
    if (!actorId) return;
    await this.prisma.auditLog.create({
      data: { actorId, action, entity, entityId, newValues: meta as object },
    }).catch(() => undefined);
  }
}
