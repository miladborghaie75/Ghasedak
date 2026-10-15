import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { EventBusService } from "../events/event-bus.service";
import {
  SHIPMENT_STATE_FA,
  SHIPMENT_STATE_HINT,
  SHIPMENT_PROGRESS_STATES,
  isTerminalShipment,
  orderStatusForShipment,
  providerFa,
  type ShipmentState,
  type TrackingEvent,
  type TrackingResult,
} from "@ghasedak/contracts";

/**
 * گذارهای مجاز مرسوله — پیشروی خطی، و شکست/بازگشت از هر مرحله غیرنهایی.
 *
 * چرا خطی؟ مرسوله پستی یک‌طرفه است؛ برگشتن به «در حال ارسال» معنایی ندارد.
 */
const FLOW: Record<string, ShipmentState[]> = {
  PENDING: ["LABEL_CREATED", "FAILED"],
  LABEL_CREATED: ["IN_TRANSIT", "FAILED"],
  IN_TRANSIT: ["DELIVERED", "RETURNED_TO_SENDER", "FAILED"],
  DELIVERED: [],
  RETURNED_TO_SENDER: [],
  FAILED: [],
};

/** وضعیت‌های سفارشی که نباید به عقب برگردند (پس از ارسال، مرجوعی) */
const ORDER_LOCKED_AFTER_SHIPMENT = new Set(["SHIPPED", "DELIVERED", "CANCELLED", "RETURNED"]);

/**
 * ترتیب پیشرفت — هرچه بزرگ‌تر، مرحلهٔ جلوتر.
 * برای انتخاب «بهترین» مرسوله وقتی یک سفارش چند مرسوله دارد.
 */
const PROGRESS_RANK: Record<ShipmentState, number> = {
  PENDING: 0,
  LABEL_CREATED: 1,
  FAILED: 1,
  IN_TRANSIT: 2,
  DELIVERED: 3,
  RETURNED_TO_SENDER: 3,
};

/** ارسال — بند ۳۷: سفارش و مرسوله جدا هستند؛ چند مرسوله مجاز. */
@Injectable()
export class ShippingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBusService,
  ) {}

  async create(input: { orderId: string; provider?: string; trackingCode?: string }) {
    const order = await this.prisma.order.findUnique({ where: { id: input.orderId } });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    if (order.paymentStatus !== "PAID") {
      throw new BadRequestException({ code: "ORDER_NOT_PAID", message: "ارسال فقط برای سفارش پرداخت‌شده." });
    }
    return this.prisma.shipment.create({
      data: {
        orderId: order.id,
        provider: input.provider ?? null,
        trackingCode: input.trackingCode ?? null,
        status: "PENDING",
      },
    });
  }

  private async assertTransition(id: string, to: ShipmentState) {
    const s = await this.prisma.shipment.findUnique({ where: { id } });
    if (!s) throw new NotFoundException({ code: "NOT_FOUND", message: "مرسوله یافت نشد." });
    if (!(FLOW[s.status] ?? []).includes(to)) {
      throw new BadRequestException({
        code: "SHIPMENT_INVALID_TRANSITION",
        message: `گذار ${SHIPMENT_STATE_FA[s.status as ShipmentState]} → ${SHIPMENT_STATE_FA[to]} مجاز نیست.`,
      });
    }
    return s;
  }

  /**
   * تحویل به پست — لحظه‌ای که کد رهگیری واقعی به دست می‌آید.
   *
   * نکتهٔ مهم: هم‌زمان وضعیت سفارش را هم جلو می‌بریم و کد را روی سفارش
   * کپی می‌کنیم. وگرنه صفحهٔ سفارش مشتری «ارسال شده» را نشان می‌داد ولی
   * کد پیگیری نداشت و مشتری نمی‌توانست مرسوله را دنبال کند.
   */
  async label(id: string, input: { provider: string; trackingCode: string }) {
    const code = String(input.trackingCode ?? "").trim();
    if (!code) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کد رهگیری الزامی است." });
    }
    const clash = await this.prisma.shipment.findFirst({
      where: { trackingCode: code, id: { not: id } },
      select: { id: true },
    });
    if (clash) {
      throw new BadRequestException({
        code: "DUPLICATE_TRACKING_CODE",
        message: `کد رهگیری «${code}» قبلاً برای مرسولهٔ دیگری ثبت شده است.`,
      });
    }

    const s = await this.assertTransition(id, "LABEL_CREATED");
    const shipment = await this.prisma.shipment.update({
      where: { id },
      data: { status: "LABEL_CREATED", provider: input.provider, trackingCode: code },
    });
    await this.syncOrder(s.orderId, "LABEL_CREATED", code);
    return shipment;
  }

  /**
   * تغییر وضعیت مرسوله. با هر گذار، سفارش هم هم‌گام می‌شود تا وضعیت
   * سفارش و مرسوله هرگز دو حرف نزنند.
   */
  async mark(id: string, to: ShipmentState, actorId?: string) {
    const s = await this.assertTransition(id, to);
    const shipment = await this.prisma.shipment.update({
      where: { id },
      data: {
        status: to,
        ...(to === "DELIVERED" ? { deliveredAt: new Date() } : {}),
        ...(s.status === "LABEL_CREATED" && to === "IN_TRANSIT" ? { shippedAt: new Date() } : {}),
      },
    });
    await this.syncOrder(s.orderId, to, s.trackingCode);
    // تحویل → رویداد دامنه؛ مصرف‌کننده (EventBus) دعوت پیامکی ثبت نظر را صف می‌کند.
    // شکست صف نافی وضعیت مرسوله نیست (همان الگوی syncOrder)؛ outbox الگوی retry خودش را دارد.
    if (to === "DELIVERED") {
      const order = await this.prisma.order.findUnique({
        where: { id: s.orderId },
        select: { code: true, guestMobile: true },
      });
      if (order?.guestMobile) {
        await this.events
          .publish("OrderDelivered", {
            orderId: s.orderId,
            orderCode: order.code,
            customerMobile: order.guestMobile,
          })
          .catch(() => undefined);
      }
    }
    void actorId;
    return shipment;
  }

  /**
   * هم‌گام‌سازی سفارش با مرسوله.
   * به عقب برنمی‌گردیم: سفارشی که SHIPPED شده با یک خطای اپراتور نباید
   * دوباره PROCESSING شود.
   */
  private async syncOrder(orderId: string, state: ShipmentState, trackingCode: string | null) {
    const target = orderStatusForShipment(state);
    try {
      const order = await this.prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
      if (!order) return;
      if (ORDER_LOCKED_AFTER_SHIPMENT.has(order.status) && target !== order.status) {
        // فقط اجازهٔ جلو رفتن به DELIVERED را می‌دهیم
        if (!(order.status === "SHIPPED" && target === "DELIVERED")) return;
      }
      await this.prisma.order.update({
        where: { id: orderId },
        data: { status: target as never, ...(trackingCode ? { trackingCode } : {}) },
      });
    } catch {
      // ناهماهنگی سفارش نباید ثبت مرسوله را خراب کند
    }
  }

  /**
   * رهگیری عمومی.
   *
   * کاربر ممکن است کد پستی را وارد کند یا کد سفارش؛ هر دو پذیرفته می‌شود
   * چون مشتری معمولاً فقط یکی از این دو را روی پیامک/رسید دارد.
   */
  async track(query: string): Promise<TrackingResult> {
    const q = String(query ?? "").trim();
    if (!q) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "کد پیگیری را وارد کنید." });
    }

    const orderInclude = { select: { code: true, items: { select: { qty: true } } } } as const;

    const byCode = await this.prisma.shipment.findFirst({
      where: { trackingCode: q },
      include: { order: orderInclude },
    });

    // با کد سفارش ممکن است چند مرسوله باشد (مثلاً مرسوله دوم هنوز برچسب
    // نخورده). پیشرفته‌ترین را نشان می‌دهیم، وگرنه مشتری کد پستی را نمی‌بیند
    // چون مرسولهٔ در انتظار جلوتر از مرسولهٔ تحویل‌شده برگردانده می‌شود.
    let shipment = byCode;
    if (!shipment) {
      const all = await this.prisma.shipment.findMany({
        where: { order: { code: q } },
        include: { order: orderInclude },
      });
      shipment =
        all
          .slice()
          .sort((a, b) => {
            const r = PROGRESS_RANK[b.status as ShipmentState] - PROGRESS_RANK[a.status as ShipmentState];
            if (r !== 0) return r;
            return b.createdAt.getTime() - a.createdAt.getTime();
          })[0] ?? null;
    }

    if (!shipment) {
      throw new NotFoundException({
        code: "TRACKING_NOT_FOUND",
        message: "مرسوله‌ای با این کد پیدا نشد. کد را دوباره بررسی کنید.",
      });
    }

    const state = shipment.status as ShipmentState;
    const events = this.buildTimeline(state, shipment.createdAt, shipment.shippedAt, shipment.deliveredAt);

    return {
      query: q,
      found: true,
      trackingCode: shipment.trackingCode,
      provider: providerFa(shipment.provider),
      state,
      stateLabel: SHIPMENT_STATE_FA[state] ?? "نامشخص",
      hint: SHIPMENT_STATE_HINT[state] ?? "",
      orderCode: shipment.order.code,
      itemCount: shipment.order.items.reduce((s, i) => s + i.qty, 0),
      createdAt: shipment.createdAt.toISOString(),
      shippedAt: shipment.shippedAt?.toISOString() ?? null,
      deliveredAt: shipment.deliveredAt?.toISOString() ?? null,
      events,
    };
  }

  /**
   * خط زمانی. مرحله‌های طی‌شده واقعی‌اند و مراحل بعدی «در انتظار» — به
   * مشتری نشان می‌دهیم سفارش کجاست، نه اینکه چیزی را جعل کنیم.
   */
  private buildTimeline(
    state: ShipmentState,
    createdAt: Date,
    shippedAt: Date | null,
    deliveredAt: Date | null,
  ): TrackingEvent[] {
    const reached = new Set<ShipmentState>(["PENDING"]);
    if (state !== "PENDING") reached.add("LABEL_CREATED");
    if (state === "IN_TRANSIT" || state === "DELIVERED" || state === "RETURNED_TO_SENDER" || state === "FAILED") {
      reached.add("IN_TRANSIT");
    }
    if (state === "DELIVERED") reached.add("DELIVERED");

    const atFor = (s: ShipmentState): string | null => {
      if (s === "PENDING") return createdAt.toISOString();
      if (s === "LABEL_CREATED") return reached.has(s) ? createdAt.toISOString() : null;
      if (s === "IN_TRANSIT") return shippedAt?.toISOString() ?? null;
      if (s === "DELIVERED") return deliveredAt?.toISOString() ?? null;
      return null;
    };

    const steps: ShipmentState[] = [...SHIPMENT_PROGRESS_STATES];

    // وضعیت‌های غیرخطی انتهای مسیر هستند و باید دیده شوند
    const abnormal: ShipmentState[] = [];
    if (state === "RETURNED_TO_SENDER") abnormal.push("RETURNED_TO_SENDER");
    if (state === "FAILED") abnormal.push("FAILED");

    const mk = (s: ShipmentState): TrackingEvent => ({
      state: s,
      label: SHIPMENT_STATE_FA[s],
      hint: SHIPMENT_STATE_HINT[s],
      at: atFor(s),
      atLabel: atFor(s) ? "ثبت شد" : "در انتظار",
    });

    return [...steps.map(mk), ...abnormal.map(mk)];
  }

  /** مرسوله‌های یک سفارش — با برچسب فارسی وضعیت برای پنل ادمین */
  async listForOrder(orderId: string) {
    if (!orderId) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "orderId الزامی است." });
    }
    const rows = await this.prisma.shipment.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" },
    });
    return {
      items: rows.map((s) => {
        const state = s.status as ShipmentState;
        return {
          id: s.id,
          provider: s.provider,
          providerFa: providerFa(s.provider),
          trackingCode: s.trackingCode,
          status: s.status,
          statusLabel: SHIPMENT_STATE_FA[state] ?? "نامشخص",
          shippedAt: s.shippedAt?.toISOString() ?? null,
          deliveredAt: s.deliveredAt?.toISOString() ?? null,
          createdAt: s.createdAt.toISOString(),
        };
      }),
    };
  }

  /** وضعیت‌های پایانی — برای UI ادمین */
  isTerminal(state: string): boolean {
    return isTerminalShipment(state as ShipmentState);
  }
}