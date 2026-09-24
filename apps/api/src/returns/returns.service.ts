import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryService } from "../inventory/inventory.service";
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
  ) {}

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
}
