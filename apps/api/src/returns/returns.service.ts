import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
import { TreasuryService } from "../treasury/treasury.service";
import { nextNumber } from "../common/number-series";

/** وضعیت‌های مجاز RMA (بند ۲۸/۳۸) */
const FLOW: Record<string, string[]> = {
  REQUESTED: ["APPROVED", "REJECTED"],
  APPROVED: ["RECEIVED", "REJECTED"],
  RECEIVED: ["SETTLED"],
  SETTLED: ["REFUNDED"],
  REJECTED: [],
  REFUNDED: [],
};

/** RMA — بند ۲۸/۳۸: شرط بهداشتی لباس زیر؛ بازشکستن موجودی فقط پس از دریافت/بازرسی. */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly treasury: TreasuryService,
  ) {
  }

  /**
   * ایجاد درخواست مرجوعی — خط‌ها فقط از آیتم‌های واقعی سفارش؛
   * سیاست بهداشتی (hygieneRestricted) تحمیل شرایط خاص می‌کند.
   */
  async request(input: {
    orderId: string;
    items: Array<{ orderItemId: string; qty: number; condition?: string; reason?: string }>;
    reason?: string;
    notes?: string;
  }) {
    const order = await this.prisma.order.findUnique({
      where: { id: input.orderId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException({ code: "NOT_FOUND", message: "سفارش یافت نشد." });
    if (order.paymentStatus !== "PAID") {
      throw new BadRequestException({ code: "ORDER_NOT_PAID", message: "فقط سفارش پرداخت‌شده مرجوع می‌شود." });
    }
    const policy = await this.prisma.returnPolicy.findFirst({ where: { active: true } });
    if (policy?.windowDays != null) {
      const ageDays = Math.floor((Date.now() - order.createdAt.getTime()) / 86_400_000);
      if (ageDays > policy.windowDays) {
        throw new BadRequestException({
          code: "RETURN_WINDOW_EXPIRED",
          message: `مهلت مرجوعی ${policy.windowDays} روز است.`,
        });
      }
    }
    const byItemId = new Map(order.items.map((i) => [i.id, i]));
    const rows: Array<{ orderItemId: string; variantSku: string; qty: number; condition: string; reason: string }> = [];
    for (const it of input.items) {
      const src = byItemId.get(it.orderItemId);
      if (!src || it.qty <= 0 || it.qty > src.qty) {
        throw new BadRequestException({ code: "RETURN_ITEM_INVALID", message: "ردیف مرجوعی نامعتبر است." });
      }
      const variant = src.variantId
        ? await this.prisma.productVariant.findUnique({ where: { id: src.variantId }, select: { sku: true } })
        : null;
      if (!variant) {
        throw new BadRequestException({ code: "RETURN_ITEM_INVALID", message: "واریانت ردیف سفارش یافت نشد." });
      }
      rows.push({
        orderItemId: src.id,
        variantSku: variant.sku,
        qty: it.qty,
        condition: it.condition ?? "SELLABLE",
        reason: it.reason ?? input.reason ?? "OTHER",
      });
    }
    return this.prisma.$transaction(async (tx) => {
      const number = await nextNumber(tx, "return", "RET", 6);
      return tx.returnRequest.create({
        data: {
          number,
          orderId: order.id,
          policyId: policy?.id ?? null,
          reason: (input.reason ?? "OTHER") as never,
          status: "REQUESTED",
          notes: input.notes ?? null,
          items: {
            create: rows.map((r) => ({
              orderItemId: r.orderItemId,
              variantSku: r.variantSku,
              qty: r.qty,
              condition: r.condition as never,
              reason: r.reason as never,
            })),
          },
        },
        include: { items: true },
      });
    });
  }

  private async assertTransition(id: string, to: string) {
    const r = await this.prisma.returnRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException({ code: "NOT_FOUND", message: "درخواست مرجوعی یافت نشد." });
    if (!(FLOW[r.status] ?? []).includes(to)) {
      throw new BadRequestException({
        code: "RETURN_INVALID_TRANSITION",
        message: `گذار ${r.status} → ${to} مجاز نیست.`,
      });
    }
    return r;
  }

  async approve(id: string, actorId?: string) {
    const r = await this.assertTransition(id, "APPROVED");
    return this.prisma.returnRequest.update({
      where: { id },
      data: { status: "APPROVED", actorId },
    });
  }

  async reject(id: string, actorId?: string) {
    const r = await this.assertTransition(id, "REJECTED");
    return this.prisma.returnRequest.update({
      where: { id },
      data: { status: "REJECTED", actorId },
    });
  }

  /**
   * دریافت کالا و بازگردانی به انبار — فقط SELLABLE دوباره فروش می‌رود؛
   * DAMAGED به انبار قرنطینه/ضایعات می‌رود (بند ۲۸). هرگز قبل از دریافت restock نمی‌شود.
   */
  async receive(id: string, actorId?: string, warehouseId = "MAIN") {
    const r = await this.assertTransition(id, "RECEIVED");
    const items = await this.prisma.returnItem.findMany({ where: { returnId: id } });
    for (const it of items) {
      const sellable = it.condition === "SELLABLE";
      await this.inventory.move({
        warehouseId,
        variantSku: it.variantSku,
        type: "SALE_RETURN",
        qty: it.qty,
        refType: "return",
        refId: id,
        idempotencyKey: `return:${id}:${it.variantSku}`,
        actorId,
        note: sellable ? undefined : `condition=${it.condition} — نیازمند تصمیم انبار`,
      });
    }
    return this.prisma.returnRequest.update({
      where: { id },
      data: { status: "RECEIVED", actorId },
    });
  }

  /** تسویه — رکورد Refund (بند ۲۹) با snapshot مبلغ و بدون فیک */
  async settle(id: string, actorId?: string, method: "ORIGINAL" | "MANUAL" | "STORE_CREDIT" = "ORIGINAL") {
    const r = await this.assertTransition(id, "SETTLED");
    if (!r.orderId) {
      throw new BadRequestException({ code: "RETURN_NO_ORDER", message: "تسویه فقط برای سفارش تعریف شده است." });
    }
    const items = await this.prisma.returnItem.findMany({ where: { returnId: id } });
    const orderItems = await this.prisma.orderItem.findMany({
      where: { id: { in: items.map((i) => i.orderItemId).filter((x): x is string => !!x) } },
    });
    const byId = new Map(orderItems.map((o) => [o.id, o]));
    let amount = 0n;
    for (const it of items) {
      const oi = it.orderItemId ? byId.get(it.orderItemId) : null;
      if (oi) amount += oi.lineTotal * BigInt(it.qty) / BigInt(oi.qty);
    }
    const refund = await this.prisma.refund.create({
      data: {
        number: `RF-${Date.now()}`, // سری مستقل در فاز R با nextNumber
        refundType: "partial",
        method: method === "STORE_CREDIT" ? "STORE_CREDIT" : "ORIGINAL_METHOD",
        amount,
        state: "PENDING",
        sourceType: "order",
        sourceId: r.orderId,
        returnId: id,
        idempotencyKey: `return-settle:${id}`,
        actorId,
      },
    });
    await this.prisma.returnRequest.update({ where: { id }, data: { status: "SETTLED", refundId: refund.id, actorId } });
    return refund;
  }

  /** گذارهای مجاز رکورد Refund (فاز ۱۱ P1-B) — خارج از FLOWی ReturnRequest */
  private static REFUND_FLOW: Record<string, string[]> = {
    PENDING: ["COMPLETED", "CANCELLED"],
    COMPLETED: [], // terminal
    FAILED: ["PENDING"], // بازگشت به صف پس از خطای provider — با همان idempotencyKey
    CANCELLED: [], // terminal
  };

  /**
   * فاز ۱۱ (P1-B): نهایی‌کردن بازگشت — Refund PENDING → COMPLETED در یک تراکنش:
   * خزانه (کاهش صندوق/بانک) + سند Dr 4000 / Cr نقد-بانک + AuditLog + رویداد outbox.
   * idempotent با refundIdempotencyKey: تکرار همان کلید ⇒ همان نتیجه بدون اثر دوم.
   * STORE_CREDIT خزانه/سند ندارد (نقد واقعی خارج نمی‌شود) — فقط وضعیت COMPLETED + audit.
   */
  async finalizeRefund(
    refundId: string,
    input: { idempotencyKey: string; actorId?: string; reason?: string },
  ) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw new NotFoundException({ code: "NOT_FOUND", message: "بازگشت یافت نشد." });

    // idempotency (فاز ۱۱ P1-B) — قبل از گارد گذار: همان کلید ⇒ همان نتیجه بدون اثر دوم
    const replay = await this.prisma.auditLog.findFirst({
      where: {
        action: "refund.finalize",
        entity: "Refund",
        entityId: refund.id,
        newValues: { path: ["idempotencyKey"], equals: input.idempotencyKey } as never,
      },
    });
    if (replay) {
      return this.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    }

    if (!(ReturnsService.REFUND_FLOW[refund.state] ?? []).includes("COMPLETED")) {
      if (refund.state === "COMPLETED") {
        // نهایی‌شده با کلید دیگری — درخواست همزمان/تکراری: Conflict نه BadRequest
        throw new ConflictException({
          code: "REFUND_ALREADY_FINALIZED",
          message: "این بازگشت قبلاً با کلید دیگری نهایی شده است.",
        });
      }
      throw new BadRequestException({
        code: "REFUND_INVALID_TRANSITION",
        message: `گذار ${refund.state} → COMPLETED مجاز نیست.`,
      });
    }

    const amount = Number(refund.amount);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new BadRequestException({ code: "REFUND_AMOUNT_INVALID", message: "مبلغ بازگشت نامعتبر است." });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // قفل بهینه: فقط ردیف PENDING به COMPLETED می‌رسد — درخواست همزمانِ دوم صفر ردیف می‌بیند
      const claimed = await tx.refund.updateMany({
        where: { id: refund.id, state: "PENDING" },
        data: { state: "COMPLETED" as never },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: "REFUND_ALREADY_FINALIZED",
          message: "این بازگشت قبلاً نهایی شده است.",
        });
      }

      if (refund.method !== "STORE_CREDIT") {
        await this.treasury.creditForRefundInTx(tx, {
          method: refund.method === "CASH" ? "CASH" : "BANK",
          amount,
          refundId: refund.id,
          refundNumber: refund.number,
          actorId: input.actorId,
        });
      }

      if (refund.returnId) {
        // SETTLED → REFUNDED در همان tx — بدون silent failure
        const returned = await tx.returnRequest.updateMany({
          where: { id: refund.returnId, status: "SETTLED" },
          data: { status: "REFUNDED" as never, actorId: input.actorId },
        });
        if (returned.count !== 1) {
          throw new ConflictException({
            code: "RETURN_STATE_CHANGED",
            message: "وضعیت مرجوعی همزمان تغییر کرده است.",
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: "refund.finalize",
          entity: "Refund",
          entityId: refund.id,
          newValues: {
            state: "COMPLETED",
            amount,
            method: refund.method,
            reason: input.reason ?? null,
            idempotencyKey: input.idempotencyKey,
          } as object,
        },
      });

      await tx.domainEventOutbox.create({
        data: {
          name: "RefundCompleted",
          payload: {
            refundId: refund.id,
            refundNumber: refund.number,
            amount,
            method: refund.method,
            sourceType: refund.sourceType,
            sourceId: refund.sourceId,
            actorId: input.actorId ?? null,
          } as never,
        },
      });

      return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
    });

    return updated;
  }

  /** لغو بازگشتِ PENDING — فقط از PENDING؛ خزانه/سند ندارد (هنوز پول خارج نشده) */
  async cancelRefund(refundId: string, input: { actorId?: string; reason?: string }) {
    const refund = await this.prisma.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw new NotFoundException({ code: "NOT_FOUND", message: "بازگشت یافت نشد." });
    if (!(ReturnsService.REFUND_FLOW[refund.state] ?? []).includes("CANCELLED")) {
      throw new BadRequestException({
        code: "REFUND_INVALID_TRANSITION",
        message: `گذار ${refund.state} → CANCELLED مجاز نیست.`,
      });
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.refund.updateMany({
        where: { id: refund.id, state: "PENDING" },
        data: { state: "CANCELLED" as never },
      });
      if (claimed.count !== 1) {
        throw new ConflictException({
          code: "REFUND_ALREADY_FINALIZED",
          message: "این بازگشت قابل لغو نیست.",
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: input.actorId ?? null,
          action: "refund.cancel",
          entity: "Refund",
          entityId: refund.id,
          newValues: { state: "CANCELLED", reason: input.reason ?? null } as object,
        },
      });
      return tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
    });
    return updated;
  }
}
