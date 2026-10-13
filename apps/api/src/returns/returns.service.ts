import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
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
    const rows: Array<{ orderItemId: string; variantSku: string; qty: number; condition: "SELLABLE" | "DAMAGED"; reason: ReturnType<() => import("@prisma/client").ReturnReason> }> = [];
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
        condition: (it.condition ?? "SELLABLE") as never,
        reason: (it.reason ?? input.reason ?? "OTHER") as never,
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
      throw new BadRequestException({ code: "INVALID_TRANSITION", message: `گذار ${r.status} → ${to} مجاز نیست.` });
    }
    return r;
  }

  async approve(id: string, actorId?: string) {
    const r = await this.assertTransition(id, "APPROVED");
    return this.prisma.returnRequest.update({ where: { id: r.id }, data: { status: "APPROVED", actorId } });
  }

  async reject(id: string, actorId?: string) {
    const r = await this.assertTransition(id, "REJECTED");
    return this.prisma.returnRequest.update({ where: { id: r.id }, data: { status: "REJECTED", actorId } });
  }

  /** دریافت کالای مرجوعی — بازگشت به انبار فقط همین‌جا (بند ۲۸) */
  async receive(id: string, actorId?: string, warehouseId = "MAIN") {
    const r = await this.assertTransition(id, "RECEIVED");
    return this.prisma.$transaction(async (tx) => {
      const items = await tx.returnItem.findMany({ where: { returnId: r.id } });
      for (const it of items) {
        if (it.condition === "SELLABLE") {
          await this.inventory.moveInTx(tx, {
            warehouseId,
            variantSku: it.variantSku,
            type: "SALE_RETURN",
            qty: it.qty,
            refType: "return_request",
            refId: r.id,
            idempotencyKey: `return-receive:${r.id}:${it.variantSku}`,
            actorId,
          });
        }
      }
      await tx.returnRequest.update({ where: { id: r.id }, data: { status: "RECEIVED", actorId } });
      await tx.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: "return.receive",
          entity: "ReturnRequest",
          entityId: r.id,
          newValues: { items: items.length } as object,
        },
      });
      return tx.returnRequest.findUnique({ where: { id: r.id }, include: { items: true } });
    });
  }

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
    FAILED: ["PENDING"],
    COMPLETED: [],
    CANCELLED: [],
  };

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
        // فاز ۱۴ بند ۱: بهای برگشتی از StockLedgerEntry قلم‌های SALE_RETURN همین مرجوعی (منبع حقیقت انبار)
        // **دو مسیر مبدأ:** آنلاین (refType=return_request، refId=ReturnRequest) و حضوری
        // (refType=pos_refund، refId=PosInvoice). پیشتر فقط pos_refund خوانده می‌شد و
        // بهای مرجوعیِ آنلاین هرگز برنمی‌گشت — موجودی و سود غلط می‌ماند.
        const isOnline = refund.sourceType === "order";
        const returnMoves = await tx.stockLedgerEntry.findMany({
          where: {
            type: "SALE_RETURN" as never,
            refType: (isOnline ? "return_request" : "pos_refund") as never,
            refId: isOnline ? (refund.returnId ?? "") : refund.sourceId,
            unitCost: { not: null },
          },
          select: { qtyIn: true, unitCost: true, variantSku: true },
        });
        let qtyBySku = new Map<string, number>();
        if (isOnline) {
          // آنلاین: مقدار واقعاً برگشته به موجودی = اقلام SELLABLE (آسیبدیده وارد انبار نمیشود)
          const items = refund.returnId
            ? await tx.returnItem.findMany({ where: { returnId: refund.returnId, condition: "SELLABLE" as never }, select: { variantSku: true, qty: true } })
            : [];
          for (const it of items) qtyBySku.set(it.variantSku, (qtyBySku.get(it.variantSku) ?? 0) + it.qty);
        } else {
          const refundItemSkus = await tx.refundItem.findMany({ where: { refundId: refund.id }, select: { variantSku: true, qty: true } });
          for (const r of refundItemSkus) {
            if (r.variantSku) qtyBySku.set(r.variantSku, r.qty);
          }
        }
        let cogsReturn = 0n;
        for (const mv of returnMoves) {
          const q = qtyBySku.get(mv.variantSku) ?? 0;
          if (q > 0 && mv.unitCost) cogsReturn += BigInt(mv.unitCost) * BigInt(Math.min(q, mv.qtyIn));
        }
        await this.treasury.creditForRefundInTx(tx, {
          method: refund.method === "CASH" ? "CASH" : "BANK",
          amount,
          refundId: refund.id,
          refundNumber: refund.number,
          actorId: input.actorId,
          cogsReturn,
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

  /**
   * فاز ۱۲ — مرجوعی حضوری POS (مبنای PosInvoice):
   * دو گامِ اتمیک و idempotent با reuse کامل قطعات فاز ۱۱:
   *   گام ۱ (این متد): بازکردن Refund PENDING از فاکتور POS + بازگشت انبار درون-tx — بدون حرکت پول؛
   *   گام ۲ (finalizeRefund موجود): پول+سند+خزانه+audit+outbox — همان lifecycle PENDING→COMPLETED.
   * مبلغ از unitPriceSnapshot فاکتور مبدأ (منبع حقیقت) — نه قیمت فعلی محصول.
   * سقف: qty مرجوعی هر SKU ≤ qty فاکتور − مرجوعی/اصلاحیه‌های قبلی.
   */
  async posInvoiceRefund(input: {
    invoiceId: string;
    lines: Array<{ variantSku: string; qty: number }>;
    method: "CASH" | "BANK" | "STORE_CREDIT";
    reason?: string;
    idempotencyKey?: string;
  }, actorId?: string) {
    if (!input.lines?.length) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "حداقل یک قلم مرجوعی الزامی است." });
    }
    const method = input.method;
    if (!["CASH", "BANK", "STORE_CREDIT"].includes(method)) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "روش بازگشت نامعتبر است." });
    }
    const source = await this.prisma.posInvoice.findUnique({
      where: { id: input.invoiceId },
      include: { items: true, payments: true },
    });
    if (!source) throw new NotFoundException({ code: "NOT_FOUND", message: "فاکتور مبدأ یافت نشد." });
    if (source.state !== "FINALIZED") {
      throw new BadRequestException({ code: "NOT_FINALIZED", message: "فقط فاکتور نهایی قابل مرجوع است." });
    }
    // فاکتور اصلاح‌شده (revision بالاتر) مبدأ مجاز نیست — آخرین نسخه مبناست
    const latest = await this.prisma.posInvoice.findFirst({
      where: { OR: [{ id: source.id }, { correctsId: source.id }] },
      orderBy: { revision: "desc" },
    });
    if (latest && latest.revision > source.revision) {
      throw new ConflictException({
        code: "STALE_SOURCE",
        message: `این فاکتور قبلاً اصلاح شده (${latest.number}) — از آخرین نسخه استفاده کنید.`,
      });
    }
    // idempotency — قبل از اعتبارسنجی سقف: replay همان کلید ⇒ همان نتیجه بدون خطای سقف
    const idem = input.idempotencyKey ?? `pos-refund:${source.id}:auto:${randomUUID()}`;
    const existing = await this.prisma.refund.findUnique({ where: { idempotencyKey: idem } });
    if (existing) {
      return { refund: existing, invoice: { id: source.id, number: source.number, state: source.state } };
    }
    // جمع مرجوع‌شدهٔ قبلی (مرجوعی‌های قبلی + اقلام اصلاحیه‌ها) به ازای هر SKU
    const priorRefunds = await this.prisma.refund.findMany({
      where: { sourceType: "pos_invoice", sourceId: source.id, state: { not: "CANCELLED" } },
      include: { items: true },
    });
    const priorBySku = new Map<string, number>();
    for (const r of priorRefunds) {
      for (const it of r.items) {
        if (it.variantSku) priorBySku.set(it.variantSku, (priorBySku.get(it.variantSku) ?? 0) + it.qty);
      }
    }
    const priorCorrections = await this.prisma.posInvoice.findMany({
      where: { correctsId: source.id },
      include: { items: true },
    });
    for (const c of priorCorrections) {
      for (const it of c.items) {
        priorBySku.set(it.variantSku, (priorBySku.get(it.variantSku) ?? 0) + it.qty);
      }
    }
    // مبلغ خط: از snapshot قیمت فاکتور منبع حقیقت است — نه قیمت فعلی محصول (بدون محاسبهٔ موازی)
    const srcItemBySku = new Map(source.items.map((i) => [i.variantSku, i]));
    const refundItems: Array<{ variantSku: string; qty: number; unitPrice: number }> = [];
    for (const line of input.lines) {
      const src = srcItemBySku.get(line.variantSku);
      if (!src) {
        throw new BadRequestException({ code: "RETURN_ITEM_INVALID", message: `قلم ${line.variantSku} در فاکتور نیست.` });
      }
      const already = priorBySku.get(line.variantSku) ?? 0;
      if (line.qty <= 0 || already + line.qty > src.qty) {
        const remaining = src.qty - already;
        throw new BadRequestException({
          code: "RETURN_QTY_EXCEEDS",
          message: `برای ${line.variantSku} فقط ${remaining} عدد قابل مرجوع است.`,
        });
      }
      refundItems.push({ variantSku: line.variantSku, qty: line.qty, unitPrice: Number(src.unitPriceSnapshot) });
    }
    const total = refundItems.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    if (total <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "مبلغ مرجوعی باید مثبت باشد." });
    }
    const refund = await this.prisma.$transaction(async (tx) => {
      // انبار: بازگشت SELLABLE درون همان tx (SALE_RETURN در IN_TYPES انبار است) — idempotent با moveInTx
      for (const it of refundItems) {
        await this.inventory.moveInTx(tx, {
          warehouseId: source.warehouseId,
          variantSku: it.variantSku,
          type: "SALE_RETURN",
          qty: it.qty,
          refType: "pos_refund",
          refId: source.id,
          idempotencyKey: `pos-refund-in:${source.id}:${it.variantSku}:${it.qty}:${idem}`,
          actorId,
          note: `مرجوعی حضوری ${source.number}`,
        });
      }
      const created = await tx.refund.create({
        data: {
          number: await nextNumber(tx, "pos_refund", "PRF", 5),
          refundType: "partial",
          method,
          amount: BigInt(total),
          state: "PENDING",
          sourceType: "pos_invoice",
          sourceId: source.id,
          idempotencyKey: idem,
          actorId,
        },
      });
      // RefundItem برای دنبال‌کردن سقف مرجوعی در مرجوعی‌های بعدی
      for (const it of refundItems) {
        await tx.refundItem.create({
          data: {
            refundId: created.id,
            variantSku: it.variantSku,
            qty: it.qty,
            amount: BigInt(it.unitPrice * it.qty),
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: actorId ?? null,
          action: "pos.refund.open",
          entity: "Refund",
          entityId: created.id,
          newValues: {
            invoice: source.number,
            lines: input.lines,
            method,
            amount: total,
            reason: input.reason ?? null,
            idempotencyKey: idem,
          } as object,
        },
      });
      return created;
    });
    return { refund, invoice: { id: source.id, number: source.number, state: source.state } };
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
