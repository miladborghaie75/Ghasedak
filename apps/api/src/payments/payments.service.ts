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
import type { PaymentProviderAdapter, PaymentRequestContext } from "./provider";
import { ZarinpalProvider } from "./zarinpal.provider";
import { MockPaymentProvider } from "./mock.provider";

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
    private readonly zarinpal: ZarinpalProvider,
    private readonly mock: MockPaymentProvider,
  ) {}

  onModuleInit(): void {
    if (this.zarinpal.isConfigured()) {
      this.providers.set("zarinpal", this.zarinpal);
    } else {
      this.logger.warn("ZarinPal NOT CONFIGURED — درگاه آنلاین تا تنظیم credential غیرفعال است.");
    }
    if (process.env.NODE_ENV !== "production") {
      this.providers.set("mock", this.mock);
    }
  }

  private adapter(code: string): PaymentProviderAdapter {
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
    return this.providers.has("zarinpal") ? "zarinpal" : "mock";
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
        callbackUrl: input.callbackUrl,
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

    const attempt = await this.prisma.paymentAttempt.create({
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

    const ctx: PaymentRequestContext = {
      attemptId: attempt.id,
      amount: Number(order.total),
      description: `سفارش ${order.code} — لباس زیر قاصدک`,
      mobile: input.guestMobile ?? null,
      callbackUrl: input.callbackUrl,
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
    if (!this.canTransition(attempt.state, "VERIFYING")) {
      throw new BadRequestException({ code: "PAYMENT_NOT_VERIFIABLE", message: "این پرداخت قابل تایید نیست." });
    }
    if (!attempt.authority) {
      throw new BadRequestException({ code: "NO_AUTHORITY", message: "شناسه پرداخت موجود نیست." });
    }
    if (attempt.expiresAt && attempt.expiresAt < new Date()) {
      await this.recordTransition(attempt.id, "EXPIRED", actorId);
      throw new BadRequestException({ code: "PAYMENT_EXPIRED", message: "مهلت پرداخت تمام شده است." });
    }

    await this.recordTransition(attempt.id, "VERIFYING", actorId);
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
    });

    if (attempt.orderId) {
      // مصرف رزرو → حرکت SALE (idempotent با کلید مشتق از refId)
      await this.inventory.consumeReservation({
        warehouseId: await this.orderWarehouse(attempt.orderId),
        refId: attempt.orderId,
        actorId,
      });
      await this.postSaleJournal(attempt.orderId, Number(attempt.amount), actorId);
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

  /** سند فروش: Dr صندوق/بانک، Cr فروش — ردیف کالاها با SKU/بارکد در توضیح */
  private async postSaleJournal(orderId: string, amount: number, actorId?: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        code: true,
        items: { select: { qty: true, titleSnapshot: true, variant: { select: { sku: true, barcode: true } } } },
      },
    });
    if (!order) return;
    const itemLines = order.items
      .map((it) => `${it.qty}× ${it.titleSnapshot} [${it.variant?.sku ?? ""}${it.variant?.barcode ? ` | بارکد ${it.variant.barcode}` : ""}]`)
      .join(" ، ");
    await this.journal.post({
      description: `فروش سفارش ${order.code} — ${itemLines}`,
      sourceType: "order",
      sourceId: orderId,
      actorId,
      lines: [
        { accountCode: "1100", debit: amount },
        { accountCode: "4000", credit: amount },
      ],
    });
  }
}
