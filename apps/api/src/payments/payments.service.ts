import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { JournalService } from "../accounting/journal.service";
import { TreasuryService } from "../treasury/treasury.service";
import type { PaymentProviderAdapter, PaymentRequestContext } from "./provider";
import { ZarinpalProvider } from "./zarinpal.provider";
import { MockPaymentProvider } from "./mock.provider";
import { resolveCallbackUrl } from "./callback-url";
import { GL, GL_COGS, GL_EXPENSE, GL_REVENUE, gatewayFeeAmount } from "@ghasedak/contracts";
import { warehouseGlCode } from "../inventory/inventory.service";

/** گذارهای مجاز وضعیت پرداخت — بند ۸: گذار دلخواه ممنوع */
const TRANSITIONS: Record<string, string[]> = {
  CREATED: ["PENDING", "REDIRECTED", "FAILED", "CANCELLED", "EXPIRED", "REQUIRES_REVIEW"],
  PENDING: ["REDIRECTED", "VERIFYING", "FAILED", "CANCELLED", "EXPIRED", "REQUIRES_REVIEW"],
  REDIRECTED: ["CALLBACK_RECEIVED", "VERIFYING", "FAILED", "CANCELLED", "EXPIRED", "REQUIRES_REVIEW"],
  CALLBACK_RECEIVED: ["VERIFYING", "FAILED", "REQUIRES_REVIEW"],
  VERIFYING: ["PAID", "FAILED", "REQUIRES_REVIEW"],
  REQUIRES_REVIEW: ["PAID", "FAILED"],
  PAID: ["REFUNDED", "PARTIALLY_REFUNDED"],
  PARTIALLY_REFUNDED: ["REFUNDED"],
  REFUNDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: [],
};

@Injectable()
export class PaymentsService implements OnModuleInit {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly providers = new Map<string, PaymentProviderAdapter>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly journal: JournalService,
    private readonly treasury: TreasuryService,
    private readonly zarinpal: ZarinpalProvider,
    private readonly mock: MockPaymentProvider,
  ) {}

  onModuleInit(): void {
    // فقط لاگ وضعیت بوت — ثبت providerها با ذخیرهٔ Merchant از کارت ادمین بلافاصله زنده می‌شود
    // (resolveZarinpal هر بار credential جاری را می‌بیند؛ freeze موقع بوت بی‌معناست)
    if (!this.zarinpal.isConfigured()) {
      this.logger.warn("ZarinPal NOT CONFIGURED at boot — با ذخیرهٔ Merchant ID از کارت ادمین، بدون ری‌استارت فعال می‌شود.");
    }
    if (process.env.NODE_ENV !== "production") {
      this.providers.set("mock", this.mock);
    }
  }

  /** زرین‌پال با credential جاری — ذخیرهٔ Merchant از کارت ادمین بلافاصله اثر دارد */
  private resolveZarinpal(): PaymentProviderAdapter | null {
    if (!this.zarinpal.isConfigured()) return null;
    this.providers.set("zarinpal", this.zarinpal);
    return this.zarinpal;
  }

  private adapter(code: string): PaymentProviderAdapter {
    if (code === "zarinpal") {
      const z = this.resolveZarinpal();
      if (z) return z;
      throw new BadRequestException({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "زرین‌پال تنظیم نشده — Merchant ID را در پنل ذخیره کنید.",
      });
    }
    const a = this.providers.get(code);
    if (!a) {
      throw new BadRequestException({
        code: "PROVIDER_NOT_CONFIGURED",
        message: "درگاه پرداخت اینترنتی فعال نیست.",
      });
    }
    return a;
  }

  private defaultCode(): string {
    return this.resolveZarinpal() ? "zarinpal" : "mock";
  }

  private async providerRowId(code: string): Promise<string> {
    const row = await this.prisma.paymentProvider.findFirst({ where: { provider: code } });
    if (row) return row.id;
    const created = await this.prisma.paymentProvider.create({
      data: {
        provider: code,
        name: code === "zarinpal" ? "زرین‌پال" : "پرداخت آزمایشی (فقط dev)",
        env: process.env.NODE_ENV === "production" ? "production" : "sandbox",
        active: true,
      },
    });
    return created.id;
  }

  private async recordTransition(id: string, state: string, actorId?: string, failReason?: string): Promise<void> {
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id }, select: { transitions: true } });
    const list = Array.isArray(attempt?.transitions) ? (attempt!.transitions as unknown[]) : [];
    await this.prisma.paymentAttempt.update({
      where: { id },
      data: {
        state: state as never,
        failReason: failReason ?? undefined,
        transitions: [...list, { state, at: new Date().toISOString(), actorId: actorId ?? null }] as object,
      },
    });
  }

  private canTransition(from: string, to: string): boolean {
    return (TRANSITIONS[from] ?? []).includes(to);
  }

  /** آغاز پرداخت آنلاین — idempotent با کلید یکتا (بند ۱۰) */
  async startOnlinePayment(input: {
    orderId: string;
    methodId: string;
    idempotencyKey: string;
    callbackUrl: string;
    guestMobile?: string;
  }): Promise<{ attemptId: string; redirectUrl: string }> {
    // گام F0-5 (P1-1): آدرس بازگشت از بدنهٔ درخواست می‌آید؛ تا اینجا هیچ
    // بررسی‌ای نداشت و به درگاه پاس داده می‌شد → بازگشت به دامنهٔ بیرونی
    // (فیشینگ بعد از پرداخت واقعی). اینجا — تنها گلوگاه — اعتبارسنجی و نرمال
    // می‌شود: نسبی روی دامنهٔ مجاز، مطلق فقط با origin مجاز، وگرنه رد.
    const callbackUrl = resolveCallbackUrl(input.callbackUrl);
    const existing = await this.prisma.paymentAttempt.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing && existing.state === "REDIRECTED" && existing.authority) {
      const attempt2 = await this.prisma.paymentAttempt.findUnique({
        where: { id: existing.id },
        include: { provider: true },
      });
      const code = attempt2?.provider?.provider ?? this.defaultCode();
      const red = await this.adapter(code).requestPayment({
        attemptId: existing.id,
        amount: Number(existing.amount),
        description: "ادامه پرداخت سفارش — قاصدک",
        mobile: input.guestMobile ?? null,
        callbackUrl,
      });
      return { attemptId: existing.id, redirectUrl: red.redirectUrl };
    }

    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    if (order.paymentStatus === "PAID") {
      throw new BadRequestException({ code: "ORDER_PAID", message: "این سفارش قبلاً پرداخت شده است." });
    }
    const method = await this.prisma.paymentMethod.findUnique({ where: { id: input.methodId } });
    if (!method || !method.active || method.code !== "online") {
      throw new BadRequestException({ code: "PAYMENT_METHOD_INVALID", message: "روش پرداخت نامعتبر است." });
    }

    const code = this.defaultCode();
    const adapter = this.adapter(code);
    const providerId = await this.providerRowId(code);

    let attempt;
    try {
      attempt = await this.prisma.paymentAttempt.create({
        data: {
          orderId: order.id,
          methodId: method.id,
          providerId,
          channelId: order.channelId,
          amount: order.total,
          state: "CREATED",
          idempotencyKey: input.idempotencyKey,
          expiresAt: new Date(Date.now() + 30 * 60_000),
        },
      });
    } catch (e) {
      // کلید هم‌زمان ثبت شده (دو کلیک موازی) — برنده را پیدا کن و همان را ادامه بده (بند ۱۱۶)
      const errCode = (e as { code?: string })?.code;
      if (errCode === "P2002") {
        // برنده ممکن است هنوز requestPayment را تمام نکرده باشد — کوتاه صبر کن تا REDIRECTED شود
        for (let i = 0; i < 20; i++) {
          const winner = await this.prisma.paymentAttempt.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            include: { provider: true },
          });
          if (winner?.authority && winner.state === "REDIRECTED") {
            const wCode = winner.provider?.provider ?? code;
            const red = await this.adapter(wCode).requestPayment({
              attemptId: winner.id,
              amount: Number(winner.amount),
              description: "ادامه پرداخت سفارش — قاصدک",
              mobile: input.guestMobile ?? null,
              callbackUrl,
            });
            return { attemptId: winner.id, redirectUrl: red.redirectUrl };
          }
          if (winner?.state === "FAILED") {
            throw new BadRequestException({ code: "PAYMENT_REQUEST_FAILED", message: "درخواست پرداخت ناموفق بود؛ دوباره تلاش کنید." });
          }
          await new Promise((r) => setTimeout(r, 150));
        }
        throw new BadRequestException({ code: "PAYMENT_IN_PROGRESS", message: "پرداخت این سفارش از قبل در جریان است؛ چند لحظه بعد دوباره تلاش کنید." });
      }
      throw e;
    }

    const ctx: PaymentRequestContext = {
      attemptId: attempt.id,
      amount: Number(order.total),
      description: `سفارش ${order.code} — لباس زیر قاصدک`,
      mobile: input.guestMobile ?? null,
      callbackUrl,
    };
    let redirectUrl: string;
    try {
      const red = await adapter.requestPayment(ctx);
      redirectUrl = red.redirectUrl;
      await this.recordTransition(attempt.id, "REDIRECTED");
      await this.prisma.paymentAttempt.update({
        where: { id: attempt.id },
        data: { authority: red.authority, providerTxId: red.authority },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "unknown";
      await this.recordTransition(attempt.id, "FAILED", undefined, msg);
      throw new BadRequestException({ code: "PAYMENT_REQUEST_FAILED", message: "درخواست پرداخت ناموفق بود." });
    }
    return { attemptId: attempt.id, redirectUrl };
  }

  /** یافتن تلاش پرداخت با authority درگاه */
  async byAuthority(authority: string) {
    return this.prisma.paymentAttempt.findFirst({ where: { authority } });
  }

  /** ثبت callback — فقط علامت‌گذاری؛ هرگز تایید نیست (بند ۷) */
  async registerCallback(authority: string, status: string): Promise<void> {
    if (authority.startsWith("MOCK-")) {
      MockPaymentProvider.recordStatus(authority, status);
    }
    const attempt = await this.prisma.paymentAttempt.findFirst({ where: { authority } });
    if (!attempt) return;
    if (!this.canTransition(attempt.state, "CALLBACK_RECEIVED")) return;
    await this.prisma.paymentAttempt.update({
      where: { id: attempt.id },
      data: { state: "CALLBACK_RECEIVED", callbackAt: new Date() },
    });
    await this.recordTransition(attempt.id, "CALLBACK_RECEIVED", undefined, `gateway status: ${status}`);
  }

  /** verify سمت‌سرور — تنها مرجع تایید؛ idempotent (بند ۷/۱۰) */
  async verify(attemptId: string, actorId?: string): Promise<{ state: string; refId?: string }> {
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new NotFoundException({ code: "NOT_FOUND", message: "پرداخت یافت نشد." });
    if (attempt.state === "PAID") {
      return { state: "PAID", refId: attempt.providerTxId ?? undefined };
    }
    if (!attempt.authority) {
      throw new BadRequestException({ code: "NO_AUTHORITY", message: "شناسه پرداخت موجود نیست." });
    }
    if (attempt.expiresAt && attempt.expiresAt < new Date()) {
      await this.recordTransition(attempt.id, "EXPIRED", actorId);
      throw new BadRequestException({ code: "PAYMENT_EXPIRED", message: "مهلت پرداخت تمام شده است." });
    }
    // VERIFYING تکراری = تلاش قبلی با خطای گذرا (شبکه/timeout درگاه) قطع شده —
    // دست‌زدنی نیست؛ همان attempt دوباره verify می‌شود (idempotent: 101 از provider)
    if (!this.canTransition(attempt.state, "VERIFYING") && attempt.state !== "VERIFYING") {
      throw new BadRequestException({ code: "PAYMENT_NOT_VERIFIABLE", message: "این پرداخت قابل تایید نیست." });
    }

    if (attempt.state !== "VERIFYING") await this.recordTransition(attempt.id, "VERIFYING", actorId);
    const withProvider = await this.prisma.paymentAttempt.findUnique({
      where: { id: attempt.id },
      include: { provider: true },
    });
    const code = withProvider?.provider?.provider ?? this.defaultCode();
    const result = await this.adapter(code).verify({
      authority: attempt.authority,
      amount: Number(attempt.amount),
    });

    if (!result.ok) {
      await this.recordTransition(attempt.id, "FAILED", actorId, `verify: ${result.reason}`);
      throw new BadRequestException({ code: "PAYMENT_VERIFY_FAILED", message: "تایید پرداخت ناموفق بود." });
    }
    return this.finalizePaid(attempt.id, result.refId, actorId);
  }

  /**
   * نهایی‌سازی پرداخت — اتمیک: PAID + سفارش PAID + مصرف رزرو + سند فروش + رویداد.
   * idempotent: سفارش PAID دوباره consume یا سند نمی‌زند (بند ۱۰/۱۱۶).
   */
  private async finalizePaid(attemptId: string, refId: string, actorId?: string): Promise<{ state: string; refId: string }> {
    const attempt = await this.prisma.paymentAttempt.findUnique({ where: { id: attemptId } });
    if (!attempt) throw new NotFoundException({ code: "NOT_FOUND", message: "پرداخت یافت نشد." });

    await this.prisma.$transaction(async (tx) => {
      if (attempt.orderId) {
        const order = await tx.order.findUnique({ where: { id: attempt.orderId } });
        if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
        if (order.paymentStatus !== "PAID") {
          await tx.order.update({
            where: { id: order.id },
            data: { paymentStatus: "PAID", status: "PAID" },
          });
          await tx.orderStatusHistory.create({
            data: { orderId: order.id, fromStatus: order.status, toStatus: "PAID", actorId, note: "پرداخت تایید شد" },
          });
        }
      }
      await tx.paymentAttempt.update({
        where: { id: attempt.id },
        data: { state: "PAID", verifiedAt: new Date(), providerTxId: refId || attempt.providerTxId },
      });
      // فاز ۸ — خزانه: ورود وجه به حساب بانکی اتمیک با تایید پرداخت (سند فروش قبلاً با postOrNotify ثبت می‌شود)
      await this.treasury.creditBankForOnlineInTx(tx, Number(attempt.amount));
    });

    if (attempt.orderId) {
      // مصرف رزرو → حرکت SALE (idempotent با کلید مشتق از refId)
      await this.inventory.consumeReservation({
        warehouseId: await this.orderWarehouse(attempt.orderId),
        refId: attempt.orderId,
        actorId,
      });
      await this.postSaleJournal(attempt.orderId, Number(attempt.amount), actorId, attempt.providerId ?? undefined);
    }

    await this.recordTransition(attempt.id, "PAID", actorId);
    // موبایل مشتری برای SMS (فقط ارسال واقعی با credential — بند ۱۱۱)
    let customerMobile: string | null = null;
    if (attempt.orderId) {
      const ord = await this.prisma.order.findUnique({ where: { id: attempt.orderId }, select: { guestMobile: true } });
      customerMobile = ord?.guestMobile ?? null;
    }
    await this.prisma.domainEventOutbox.create({
      data: {
        name: "OrderPaid",
        payload: {
          orderId: attempt.orderId,
          attemptId: attempt.id,
          amount: Number(attempt.amount),
          customerMobile,
        } as object,
      },
    });
    return { state: "PAID", refId };
  }

  private async orderWarehouse(orderId: string): Promise<string> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { warehouseId: true } });
    if (!order || !order.warehouseId) {
      throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یا انبار یافت نشد." });
    }
    return order.warehouseId;
  }

  /** سند فروش: Dr صندوق/بانک، Cr فروش + (فاز ۱۴ بند ۱) Dr بهای تمام‌شده / Cr موجودی کالا — ردیف کالاها با SKU/بارکد در توضیح
   *
   * گام ۲ و ۳ فاز ۲: تخفیف و درآمد ارسال از فروش تفکیک شده‌اند و کارمزد
   * درگاه (اگر از جیب فروشگاه باشد) در همان سند هزینه ثبت می‌شود.
   */
  private async postSaleJournal(
    orderId: string,
    amount: number,
    actorId?: string,
    providerId?: string,
  ): Promise<void> {
        /**
     * معین طرف حساب (گام ۶ فاز ۲).
     *
     * `partyType`/`partyId` روی خطوط درآمد/بدهی می‌نشیند تا فاز ۵ بتواند
     * گزارش «فروش به تفکیک مشتری» و «حساب‌های دریافتنی به تفکیک بدهکار»
     * بدهد. قبلاً این دو ستون **هرگز** پر نمی‌شدند، پس گزارش معینِ اشخاص
     * غیرممکن بود.
     *
     * فقط روی خط درآمد: مشتریِ سفارش را می‌نشانیم (تأمین‌کننده در سند خرید).
     */
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        code: true,
        warehouseId: true,
        // تفکیک مبلغ لازم است تا تخفیف و ارسال در سند گم نشوند (گام ۲ فاز ۲)
        subtotal: true,
        discountTotal: true,
        shippingCost: true,
        customerId: true,
        items: { select: { qty: true, titleSnapshot: true, variant: { select: { sku: true, barcode: true } } } },
      },
    });
    if (!order) return;
    const itemLines = order.items
      .map((it) => `${it.qty}× ${it.titleSnapshot} [${it.variant?.sku ?? ""}${it.variant?.barcode ? ` | بارکد ${it.variant.barcode}` : ""}]`)
      .join(" ، ");

    /**
     * تفکیک فروش (گام ۲ فاز ۲) — قبلاً همه‌چیز روی `4000` می‌نشست، پس
     * «چقدر واقعاً فروختم» و «چقدر تخفیف دادم» از دفتر قابل تشخیص نبود.
     *
     *   Dr 1100 بانک            = مبلغی که مشتری پرداخت کرد
     *   Cr 4000 فروش            = جمع فاکتور قبل از تخفیف (subtotal)
     *   Cr 4000-02 درآمد ارسال  = هزینهٔ ارسالی که از مشتری گرفته شد
     *   Dr 4000-01 برگشت فروش   = تخفیفی که دادیم (کاهش درآمد)
     *
     * جمع بستانکار = subtotal + shipping − discount = grandTotal = مبلغ بانک ✔
     */
    const subtotal = Number(order.subtotal ?? 0);
    const discount = Number(order.discountTotal ?? 0);
    const shipping = Number(order.shippingCost ?? 0);

    /**
     * فاز ۲٫۵ — درگاه اعتباری پول را کند و ناقص به حساب ما می‌رساند.
     *
     * تشخیص: خودِ درگاه `settlementDays > 1` دارد یعنی «پول فوری نیست».
     * تا وقتی این تفکیک نبود، کل مبلغ در همان لحظه به بانک می‌رفت و دفتر
     * بیشتر از واقعیت نشان می‌داد.
     *
     * اگر درگاه واقعاً اعتباری بود ولی درگاه‌اش را هنوز نساخته بود، خطا می‌دهیم
     * — چون حدس زدن یعنی دفتر نادرست.
     */
    let cashOrGatewayCode: string = GL.BANK;
    if (providerId) {
      const prov = await this.prisma.paymentProvider.findUnique({
        where: { id: providerId },
        select: { id: true, name: true, settlementDays: true, active: true },
      });
      if (prov?.active && (prov.settlementDays ?? 1) > 1) {
        const receivable = await this.prisma.account.findUnique({
          where: { code: GL.GATEWAY_RECEIVABLE },
          select: { code: true },
        });
        if (!receivable) {
          throw new BadRequestException({
            code: "GL_MISSING",
            message: `درگاه «${prov.name}» اعتباری است (تسویه ${prov.settlementDays} روزه) ولی حساب ${GL.GATEWAY_RECEIVABLE} تعریف نشده است.`,
          });
        }
        cashOrGatewayCode = GL.GATEWAY_RECEIVABLE;
      }
    }

    // اگر داده‌های تفکیکی ناقص یا ناسازگار بود، به‌جای سند غلط فقط مبلغ
    // دریافتی را می‌نشانیم (همان رفتار قبلی، ولی بدون ادعای تفکیک)
    const partsConsistent =
      subtotal > 0 && subtotal + shipping - discount === amount;

    const lines: Array<{
      accountCode: string;
      debit?: number;
      credit?: number;
      partyType?: string;
      partyId?: string;
    }> = [
      // درگاه اعتباری: پول هنوز به حساب ما نیامده ⇒ به «طلب از درگاه» می‌رود
      // (فاز ۲٫۵). درگاه نقدی: مستقیم به بانک.
      { accountCode: cashOrGatewayCode, debit: amount },
    ];
    if (partsConsistent) {
      lines.push({
        accountCode: GL_REVENUE.SALES,
        credit: subtotal,
        // معین: خط درآمد به مشتریِ همین سفارش سنجاق می‌شود
        partyType: order.customerId ? "customer" : undefined,
        partyId: order.customerId ?? undefined,
      });
      if (shipping > 0) lines.push({ accountCode: GL_REVENUE.SHIPPING, credit: shipping });
      if (discount > 0) lines.push({ accountCode: GL_REVENUE.SALES_RETURN, debit: discount });
    } else {
      // بدون تفکیک معتبر، فروش را همان‌طور که مشتری پرداخت کرده ثبت می‌کنیم
      lines.push({
        accountCode: GL_REVENUE.SALES,
        credit: amount,
        partyType: order.customerId ? "customer" : undefined,
        partyId: order.customerId ?? undefined,
      });
    }

    // فاز ۱۴ — بند ۱: بهای تمام‌شدهٔ فروش آنلاین در همان سند فروش (Dr 5000 / Cr 1200).
    // میانگین انبارِ سفارش؛ بدون بهای ثبت‌شده → سند COGS زده نمی‌شود (صادقانه).
    if (order.warehouseId) {
      let cogsTotal = 0n;
      for (const it of order.items) {
        if (!it.variant?.sku) continue;
        const wac = await this.inventory.wac(order.warehouseId, it.variant.sku);
        if (wac != null && wac > 0n) cogsTotal += wac * BigInt(it.qty);
      }
      if (cogsTotal > 0n && order.warehouseId) {
        lines.push({ accountCode: GL_COGS.COGS, debit: Number(cogsTotal) });
        // حساب موجودیِ همان انباری که فروش از آن شد (فاز ۶)
        const invCode = await warehouseGlCode(this.prisma, order.warehouseId);
        lines.push({ accountCode: invCode, credit: Number(cogsTotal) });
      }
    }

    /**
     * کارمزد درگاه (گام ۳ فاز ۲).
     *
     * تنها وقتی در همین سند می‌نشیند که **از جیب فروشگاه** باشد
     * (`MERCHANT`): آن‌وقت پولی که به بانک نشست کمتر از مبلغ فاکتور است،
     * پس هزینهٔ کارمزد باید در همان سند دیده شود وگرنه سود فروش بیش‌برآورد
     * می‌شود.
     *
     * اگر از جیب خریدار باشد (`CUSTOMER`)، مبلغی که به بانک نشسته خالصِ
     * درآمد فروشگاه است و کارمزد در سند فروش نمی‌آید — چون اصلاً از جیب ما
     * نرفته. در آن حالت کارمزد در تسویه (فاز ۲٫۵) دیده می‌شود.
     */
    if (providerId) {
      const provider = await this.prisma.paymentProvider.findUnique({
        where: { id: providerId },
        select: { feePercentBps: true, feeFlatToman: true, feeBorneBy: true, name: true },
      });
      if (provider && provider.feeBorneBy === "MERCHANT") {
        const fee = gatewayFeeAmount(amount, provider.feePercentBps, provider.feeFlatToman);
        if (fee > 0) {
          // هزینهٔ کارمزد: Dr هزینه، Cr همان حسابی که پول از آن خارج شد
          // (بانک برای درگاه نقدی، طلب از درگاه برای اعتباری)
          lines.push({ accountCode: GL_EXPENSE.GATEWAY_FEE, debit: fee });
          lines.push({ accountCode: cashOrGatewayCode, credit: fee });
        }
      }
    }

    await this.journal.postOrNotify({
      description: `فروش سفارش ${order.code} — ${itemLines}`,
      sourceType: "order",
      sourceId: orderId,
      // انبار فروش (فاز ۶). اگر سفارش انبار نداشته باشد، سند بدون انبار ثبت
      // می‌شود — بهتر از اینکه انبار نادرست حدس زده شود.
      ...(order.warehouseId ? { warehouseId: order.warehouseId } : {}),
      actorId,
      lines,
    });
  }
}
