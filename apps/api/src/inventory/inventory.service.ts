import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventorySettingsService } from "./inventory-settings.service";
import type { PrismaTransaction } from "../common/tx";

/**
 * موتور انبار — بند ۱۲/۱۴/۱۸: Ledger منبع حقیقت، رزرو ≠ مصرف، اتمیک و ایمن در برابر Race.
 * همه حرکت‌ها در یک تراکنش DB انجام می‌شوند؛ موجودی منفی هرگز مجاز نیست (بند ۹۱)
 * مگر inventoryPolicy کانال backorder باشد (اینجا پشتیبانی نمی‌شود — صریح رد می‌شود).
 */

export interface MoveInput {
  warehouseId: string;
  variantSku: string;
  type:
    | "PURCHASE" | "SALE" | "SALE_RETURN" | "PURCHASE_RETURN"
    | "TRANSFER_OUT" | "TRANSFER_IN" | "ADJUSTMENT" | "DAMAGE" | "LOSS" | "CORRECTION" | "OPENING";
  qty: number; // مثبت — جهت از type مشخص می‌شود
  unitCost?: bigint | null;
  refType?: string;
  refId?: string;
  idempotencyKey: string;
  actorId?: string;
  note?: string;
}

const IN_TYPES = new Set(["PURCHASE", "SALE_RETURN", "TRANSFER_IN", "OPENING", "ADJUSTMENT"]);
const OUT_TYPES = new Set(["SALE", "PURCHASE_RETURN", "TRANSFER_OUT", "DAMAGE", "LOSS"]);

/** حذف رزروهای منقضی — بند ۱۴: TTL رزرو؛ فراخوانی از worker و قبل از محاسبه available */
export async function releaseExpiredReservations(prisma: PrismaService): Promise<number> {
  const expired = await prisma.stockReservation.updateMany({
    where: { state: "ACTIVE", expiresAt: { lt: new Date() } },
    data: { state: "RELEASED" },
  });
  return expired.count;
}

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: InventorySettingsService,
  ) {}

  /** موجودی لحظه‌ای از منبع حقیقت Ledger + رزرو فعال + قرنطینه — بند ۳۵: Available = Sellable − Reserved */
  async available(warehouseId: string, variantSku: string): Promise<{
    onHand: number; reserved: number; quarantine: number; available: number;
  }> {
    await releaseExpiredReservations(this.prisma);
    const ledger = await this.prisma.stockLedgerEntry.aggregate({
      where: { warehouseId, variantSku },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const onHand = (ledger._sum.qtyIn ?? 0) - (ledger._sum.qtyOut ?? 0);
    const reserved = await this.prisma.stockReservation.aggregate({
      where: { warehouseId, variantSku, state: "ACTIVE" },
      _sum: { qty: true },
    });
    const r = reserved._sum.qty ?? 0;
    const q = await this.prisma.quarantineRecord.aggregate({
      where: { warehouseId, variantSku, state: "HELD" },
      _sum: { qty: true },
    });
    const quarantine = q._sum.qty ?? 0;
    return { onHand, reserved: r, quarantine, available: onHand - r - quarantine };
  }

  /**
   * حرکت انبار اتمیک — بند ۹۲: همه چیز در یک تراکنش؛ balanceBefore/After دقیق؛ idempotent.
   * برای OUTها تراز کافی چک می‌شود؛ رقابت با قفل روی واریانت ترتیب‌بندی می‌شود.
   */
  async move(input: MoveInput): Promise<{ id: string; balanceAfter: number }> {
    if (!Number.isSafeInteger(input.qty) || input.qty === 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تعداد باید عدد صحیح غیرصفر باشد." });
    }
    // ADJUSTMENT با علامت: مثبت = ورود، منفی = خروج (انبارگردانی)؛ بقیه qty مثبت با جهت از type
    if (input.type !== "ADJUSTMENT" && input.qty <= 0) {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "تعداد باید مثبت باشد." });
    }
    const signedIn = input.type === "ADJUSTMENT" ? input.qty > 0 : IN_TYPES.has(input.type);
    if (!signedIn && !OUT_TYPES.has(input.type) && input.type !== "ADJUSTMENT") {
      throw new BadRequestException({ code: "VALIDATION_ERROR", message: "نوع حرکت نامعتبر است." });
    }
    const normalized: MoveInput = input.type === "ADJUSTMENT"
      ? { ...input, qty: Math.abs(input.qty) }
      : input;
    return this.prisma.$transaction(async (tx) => this.moveInTx(tx, normalized, signedIn));
  }

  /** نسخه داخل تراکنش — برای ترکیب با Order/POS در یک atomic unit */
  async moveInTx(tx: PrismaTransaction, input: MoveInput, forceIn?: boolean): Promise<{ id: string; balanceAfter: number }> {
    // idempotency (بند ۱۱۶): کلید تکراری → همان حرکت قبلی برگردانده می‌شود
    const existing = await tx.stockLedgerEntry.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return { id: existing.id, balanceAfter: existing.balanceAfter };

    // قفل ترتیبی روی واریانت برای جلوگیری از deadlock رقابتی
    await tx.$queryRaw`SELECT "sku" FROM "ProductVariant" WHERE "sku" = ${input.variantSku} FOR UPDATE`;
    const agg = await tx.stockLedgerEntry.aggregate({
      where: { warehouseId: input.warehouseId, variantSku: input.variantSku },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const onHand = (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
    const isIn = forceIn !== undefined ? forceIn : IN_TYPES.has(input.type);
    const balanceBefore = onHand;
    const balanceAfter = isIn ? onHand + input.qty : onHand - input.qty;
    if (balanceAfter < 0) {
      throw new ConflictException({
        code: "INSUFFICIENT_STOCK",
        message: "موجودی کافی نیست.",
      });
    }
    // بهای واحد: صریح یا WAC جاری (بند ۳۲) — روی OUT و تعدیل منفی
    const unitCost = input.unitCost ?? (isIn ? null : await this.wacInTx(tx, input.warehouseId, input.variantSku));
    const entry = await tx.stockLedgerEntry.create({
      data: {
        warehouseId: input.warehouseId,
        variantSku: input.variantSku,
        type: input.type,
        qtyIn: isIn ? input.qty : 0,
        qtyOut: isIn ? 0 : input.qty,
        balanceBefore,
        balanceAfter,
        unitCost: unitCost ?? null,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        idempotencyKey: input.idempotencyKey,
        actorId: input.actorId ?? null,
        note: input.note ?? null,
      },
    });
    // projection نمایشی روی واریانت — حقیقت Ledger است (بند ۱۳۵)
    const variant = await tx.productVariant.findUnique({ where: { sku: input.variantSku } });
    if (!variant) throw new NotFoundException({ code: "VARIANT_NOT_FOUND", message: "واریانت یافت نشد." });
    const nextStock = variant.stockQty + (isIn ? input.qty : -input.qty);
    await tx.productVariant.update({ where: { sku: input.variantSku }, data: { stockQty: nextStock } });
    // رویدادهای آستانه — فقط روی حرکت‌های مستقل (نه داخل تراکنش سفارش) منتشر می‌شوند
    await this.emitThresholdEvents(tx, input.warehouseId, input.variantSku, isIn ? input.qty : -input.qty, input.actorId);
    return { id: entry.id, balanceAfter };
  }

  /** WAC جاری از CostLayer؛ در نبود لایه از میانگین ورودی‌های بهایی Ledger */
  async wacInTx(tx: PrismaTransaction, warehouseId: string, variantSku: string): Promise<bigint | null> {
    const layer = await tx.costLayer.findUnique({
      where: { warehouseId_variantSku: { warehouseId, variantSku } },
    });
    if (layer && layer.quantity > 0) return layer.avgUnitCost;
    const agg = await tx.stockLedgerEntry.aggregate({
      where: { warehouseId, variantSku, type: { in: ["PURCHASE", "OPENING"] as never }, unitCost: { not: null } },
      _sum: { qtyIn: true },
    });
    const totalQty = agg._sum.qtyIn ?? 0;
    if (totalQty <= 0) return null;
    const rows = await tx.stockLedgerEntry.findMany({
      where: { warehouseId, variantSku, type: { in: ["PURCHASE", "OPENING"] as never }, unitCost: { not: null } },
      select: { qtyIn: true, unitCost: true },
    });
    let total = 0n;
    for (const row of rows) total += BigInt(row.qtyIn) * (row.unitCost ?? 0n);
    return total / BigInt(totalQty);
  }

  /** به‌روزرسانی لایه هزینه (WAC) پس از ورود بهایی — بند ۳۲؛ عدد صحیح تومان */
  async updateWacInTx(tx: PrismaTransaction, warehouseId: string, variantSku: string, inQty: number, inUnitCost: bigint): Promise<bigint> {
    const layer = await tx.costLayer.findUnique({
      where: { warehouseId_variantSku: { warehouseId, variantSku } },
    });
    const prevQty = layer?.quantity ?? 0;
    const prevTotal = layer?.totalCost ?? 0n;
    const nextQty = Math.max(0, prevQty + inQty);
    const nextTotal = prevQty + inQty > 0
      ? prevTotal + inUnitCost * BigInt(inQty)
      : inUnitCost * BigInt(inQty);
    const avg = nextQty > 0 ? nextTotal / BigInt(nextQty) : 0n;
    const data = {
      quantity: nextQty,
      totalCost: nextTotal,
      avgUnitCost: avg,
      lastCost: inUnitCost,
      costingStrategy: "WAC",
    };
    await tx.costLayer.upsert({
      where: { warehouseId_variantSku: { warehouseId, variantSku } },
      update: data,
      create: { warehouseId, variantSku, ...data },
    });
    return avg;
  }

  /** نسخه داخل تراکنش از available — بدون انتشار رویداد */
  async availableInTx(tx: PrismaTransaction, warehouseId: string, variantSku: string): Promise<{ onHand: number; reserved: number; quarantine: number; available: number }> {
    const ledger = await tx.stockLedgerEntry.aggregate({
      where: { warehouseId, variantSku },
      _sum: { qtyIn: true, qtyOut: true },
    });
    const onHand = (ledger._sum.qtyIn ?? 0) - (ledger._sum.qtyOut ?? 0);
    const reserved = await tx.stockReservation.aggregate({
      where: { warehouseId, variantSku, state: "ACTIVE" },
      _sum: { qty: true },
    });
    const q = await tx.quarantineRecord.aggregate({
      where: { warehouseId, variantSku, state: "HELD" },
      _sum: { qty: true },
    });
    const r = reserved._sum.qty ?? 0;
    const quarantine = q._sum.qty ?? 0;
    return { onHand, reserved: r, quarantine, available: onHand - r - quarantine };
  }

  /** رزرو — بند ۱۴/۱۸: با چک available در همان تراکنش؛ TTL از تنظیمات */
  async reserve(input: {
    warehouseId: string;
    lines: Array<{ variantSku: string; qty: number }>;
    refType: string;
    refId: string;
    ttlMinutes?: number;
  }): Promise<void> {
    const ttl = input.ttlMinutes ?? await this.settings.get<number>("reservationTtlMinutes");
    await this.prisma.$transaction(async (tx) => {
      for (const line of input.lines) {
        await tx.$queryRaw`SELECT "sku" FROM "ProductVariant" WHERE "sku" = ${line.variantSku} FOR UPDATE`;
        await releaseExpiredReservationsTx(tx);
        const agg = await tx.stockLedgerEntry.aggregate({
          where: { warehouseId: input.warehouseId, variantSku: line.variantSku },
          _sum: { qtyIn: true, qtyOut: true },
        });
        const onHand = (agg._sum.qtyIn ?? 0) - (agg._sum.qtyOut ?? 0);
        const active = await tx.stockReservation.aggregate({
          where: { warehouseId: input.warehouseId, variantSku: line.variantSku, state: "ACTIVE" },
          _sum: { qty: true },
        });
        const q = await tx.quarantineRecord.aggregate({
          where: { warehouseId: input.warehouseId, variantSku: line.variantSku, state: "HELD" },
          _sum: { qty: true },
        });
        const reserved = active._sum.qty ?? 0;
        if (onHand - reserved - (q._sum.qty ?? 0) < line.qty) {
          throw new ConflictException({
            code: "INSUFFICIENT_STOCK",
            message: `موجودی قابل فروش «${line.variantSku}» کافی نیست.`,
          });
        }
        await tx.stockReservation.create({
          data: {
            warehouseId: input.warehouseId,
            variantSku: line.variantSku,
            qty: line.qty,
            refType: input.refType,
            refId: input.refId,
            expiresAt: new Date(Date.now() + ttl * 60_000),
          },
        });
        const variant = await tx.productVariant.findUnique({ where: { sku: line.variantSku } });
        if (variant) {
          await tx.productVariant.update({
            where: { sku: line.variantSku },
            data: { reservedQty: variant.reservedQty + line.qty },
          });
        }
      }
    });
  }

  /** آزادسازی رزرو — هنگام کنسلی/خطای پرداخت (بند ۱۴) */
  async releaseByRef(refId: string): Promise<number> {
    const rows = await this.prisma.stockReservation.updateMany({
      where: { refId, state: "ACTIVE" },
      data: { state: "RELEASED" },
    });
    // projection بازگردانی
    const released = await this.prisma.stockReservation.findMany({ where: { refId, state: "RELEASED" } });
    const bySku = new Map<string, number>();
    for (const r of released) bySku.set(r.variantSku, (bySku.get(r.variantSku) ?? 0) + r.qty);
    for (const [sku, qty] of bySku) {
      const v = await this.prisma.productVariant.findUnique({ where: { sku } });
      if (v) {
        await this.prisma.productVariant.update({
          where: { sku },
          data: { reservedQty: Math.max(0, v.reservedQty - qty) },
        });
      }
    }
    return rows.count;
  }

  /**
   * مصرف رزرو → حرکت SALE (بند ۱۴): Reserved کم، OnHand کم، Ledger SALE.
   * کلید idempotency از refId مشتق می‌شود — پرداخت دوباره هرگز دوبار کم نمی‌کند.
   */
  async consumeReservation(input: {
    warehouseId: string;
    refId: string;
    actorId?: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const reservations = await tx.stockReservation.findMany({
        where: { refId: input.refId, state: "ACTIVE" },
      });
      if (reservations.length === 0) return; // قبلاً مصرف/آزاد شده — idempotent
      for (const r of reservations) {
        await tx.stockReservation.update({ where: { id: r.id }, data: { state: "CONSUMED" } });
        const variant = await tx.productVariant.findUnique({ where: { sku: r.variantSku } });
        if (variant) {
          await tx.productVariant.update({
            where: { sku: r.variantSku },
            data: { reservedQty: Math.max(0, variant.reservedQty - r.qty) },
          });
        }
        await this.moveInTx(tx, {
          warehouseId: r.warehouseId,
          variantSku: r.variantSku,
          type: "SALE",
          qty: r.qty,
          refType: "order",
          refId: input.refId,
          idempotencyKey: `sale:${input.refId}:${r.variantSku}`,
          actorId: input.actorId,
        });
      }
    });
  }

  /**
   * رویدادهای آستانه — LowStockStockAlert (یک‌بار در هر فرود) و StockRestocked.
   * همیشه publish می‌شود (Outbox)؛ ارسال SMS/نوتیف فقط در EventBus با تنظیمات انجام می‌شود.
   */
  private async emitThresholdEvents(
    tx: PrismaTransaction,
    warehouseId: string,
    variantSku: string,
    delta: number,
    actorId?: string,
  ): Promise<void> {
    try {
      const variant = await tx.productVariant.findUnique({
        where: { sku: variantSku },
        select: { stockQty: true, lowStockThreshold: true },
      });
      if (!variant) return;
      const lowOn = variant.lowStockThreshold > 0 && variant.stockQty <= variant.lowStockThreshold;
      if (lowOn && delta < 0) {
        const recent = await tx.domainEventOutbox.findFirst({
          where: { name: "LowStockStockAlert", createdAt: { gte: new Date(Date.now() - 6 * 3600_000) } },
        });
        if (!recent) {
          await tx.domainEventOutbox.create({
            data: {
              name: "LowStockStockAlert",
              payload: { warehouseId, variantSku, stockQty: variant.stockQty, threshold: variant.lowStockThreshold, actorId } as never,
            },
          });
        }
      }
      if (delta > 0) {
        const minQty = await this.settings.get<number>("minRestockQty");
        if (delta >= minQty) {
          await tx.domainEventOutbox.create({
            data: { name: "StockRestocked", payload: { warehouseId, variantSku, qty: delta, actorId } as never },
          }).catch(() => undefined); // تکراری — idempotent
        }
      }
    } catch {
      // رویداد هرگز حرکت انبار را fail نمی‌کند
    }
  }
}

/** نسخه tx-محور برای استفاده داخل تراکنش‌ها */
async function releaseExpiredReservationsTx(tx: PrismaTransaction): Promise<void> {
  await tx.stockReservation.updateMany({
    where: { state: "ACTIVE", expiresAt: { lt: new Date() } },
    data: { state: "RELEASED" },
  });
}
