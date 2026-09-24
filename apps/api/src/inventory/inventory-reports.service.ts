import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventorySettingsService } from "./inventory-settings.service";

/**
 * گزارش‌های انبار — همه از منبع حقیقت Ledger/CostLayer محاسبه می‌شوند؛
 * پنجره‌های زمانی (deadStockDays / fastMoverDays) از تنظیمات خوانده می‌شوند (قانون ۶).
 */

export interface ValuationRow {
  warehouseId: string; warehouseCode: string; warehouseName: string;
  sku: string; productName: string; onHand: number; avgUnitCost: string; value: string;
}

@Injectable()
export class InventoryReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: InventorySettingsService,
  ) {}

  /** ارزش‌گذاری انبار — تراز Ledger × WAC هر واریانت به تفکیک انبار */
  async valuation(): Promise<{ rows: ValuationRow[]; total: string }> {
    const entries = await this.prisma.stockLedgerEntry.groupBy({
      by: ["warehouseId", "variantSku"],
      _sum: { qtyIn: true, qtyOut: true },
    });
    const warehouses = await this.prisma.warehouse.findMany();
    const whById = new Map(warehouses.map((w) => [w.id, w]));
    const skus = [...new Set(entries.map((e) => e.variantSku))];
    const variants = await this.prisma.productVariant.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, product: { select: { name: true } } },
    });
    const vBySku = new Map(variants.map((v) => [v.sku, v]));
    const layers = await this.prisma.costLayer.findMany();
    const layerKey = (whId: string, sku: string) => `${whId}:${sku}`;
    const layerBy = new Map(layers.map((l) => [layerKey(l.warehouseId, l.variantSku), l]));

    const rows: ValuationRow[] = [];
    let total = 0n;
    for (const e of entries) {
      const onHand = (e._sum.qtyIn ?? 0) - (e._sum.qtyOut ?? 0);
      if (onHand <= 0) continue;
      const layer = layerBy.get(layerKey(e.warehouseId, e.variantSku));
      const unitCost = layer && layer.quantity > 0 ? layer.avgUnitCost : await this.fallbackWac(e.warehouseId, e.variantSku);
      const value = BigInt(onHand) * (unitCost ?? 0n);
      total += value;
      const wh = whById.get(e.warehouseId);
      const v = vBySku.get(e.variantSku);
      rows.push({
        warehouseId: e.warehouseId,
        warehouseCode: wh?.code ?? "—",
        warehouseName: wh?.name ?? "—",
        sku: e.variantSku,
        productName: v?.product.name ?? e.variantSku,
        onHand,
        avgUnitCost: (unitCost ?? 0n).toString(),
        value: value.toString(),
      });
    }
    rows.sort((a, b) => (BigInt(b.value) > BigInt(a.value) ? 1 : -1));
    return { rows: rows.slice(0, 500), total: total.toString() };
  }

  private async fallbackWac(warehouseId: string, sku: string): Promise<bigint | null> {
    const rows = await this.prisma.stockLedgerEntry.findMany({
      where: { warehouseId, variantSku: sku, type: { in: ["PURCHASE", "OPENING"] }, unitCost: { not: null } },
      select: { qtyIn: true, unitCost: true },
    });
    let qty = 0; let total = 0n;
    for (const r of rows) { qty += r.qtyIn; total += BigInt(r.qtyIn) * (r.unitCost ?? 0n); }
    return qty > 0 ? total / BigInt(qty) : null;
  }

  /** Dead Stock — هیچ خروجی (فروش/انتقال/خرابی) در deadStockDays روز گذشته */
  async deadStock(): Promise<{ days: number; rows: Array<{ sku: string; productName: string; stockQty: number; lastOutAt: string | null; daysSinceOut: number | null; value: string }> }> {
    const days = await this.settings.get<number>("deadStockDays");
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const outs = await this.prisma.stockLedgerEntry.groupBy({
      by: ["variantSku"],
      where: { type: { in: ["SALE", "TRANSFER_OUT", "DAMAGE", "LOSS", "PURCHASE_RETURN"] }, createdAt: { gte: since } },
      _max: { createdAt: true },
    });
    const recentOut = new Map(outs.map((o) => [o.variantSku, o._max.createdAt]));
    const variants = await this.prisma.productVariant.findMany({
      where: { stockQty: { gt: 0 }, status: "PUBLISHED", deletedAt: null, product: { deletedAt: null } },
      select: { sku: true, stockQty: true, product: { select: { name: true, costPrice: true } } },
    });
    const rows = [];
    for (const v of variants) {
      if (recentOut.has(v.sku)) continue;
      const last = await this.prisma.stockLedgerEntry.findFirst({
        where: { variantSku: v.sku, type: { in: ["SALE", "TRANSFER_OUT", "DAMAGE", "LOSS", "PURCHASE_RETURN"] } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const unitCost = v.product.costPrice != null ? BigInt(v.product.costPrice) : 0n;
      rows.push({
        sku: v.sku,
        productName: v.product.name,
        stockQty: v.stockQty,
        lastOutAt: last?.createdAt.toISOString() ?? null,
        daysSinceOut: last ? Math.floor((Date.now() - last.createdAt.getTime()) / 86400_000) : null,
        value: (unitCost * BigInt(v.stockQty)).toString(),
      });
    }
    rows.sort((a, b) => b.stockQty * Number(b.value) - a.stockQty * Number(a.value));
    return { days, rows: rows.slice(0, 300) };
  }

  /** Fast/Slow Mover — تعداد فروش در fastMoverDays روز */
  async fastSlow(): Promise<{ days: number; rows: Array<{ sku: string; productName: string; soldQty: number; stockQty: number; rank: string }> }> {
    const days = await this.settings.get<number>("fastMoverDays");
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const sales = await this.prisma.stockLedgerEntry.groupBy({
      by: ["variantSku"],
      where: { type: "SALE", createdAt: { gte: since } },
      _sum: { qtyOut: true },
      orderBy: { _sum: { qtyOut: "desc" } },
    });
    const variants = await this.prisma.productVariant.findMany({
      where: { sku: { in: sales.map((s) => s.variantSku) } },
      select: { sku: true, stockQty: true, product: { select: { name: true } } },
    });
    const vBySku = new Map(variants.map((v) => [v.sku, v]));
    const totalSold = sales.reduce((acc, s) => acc + (s._sum.qtyOut ?? 0), 0);
    const rows = sales.map((s) => {
      const sold = s._sum.qtyOut ?? 0;
      const share = totalSold > 0 ? sold / totalSold : 0;
      return {
        sku: s.variantSku,
        productName: vBySku.get(s.variantSku)?.product.name ?? s.variantSku,
        soldQty: sold,
        stockQty: vBySku.get(s.variantSku)?.stockQty ?? 0,
        rank: share >= 0.05 ? "FAST" : sold > 0 ? "NORMAL" : "SLOW",
      };
    });
    return { days, rows: rows.slice(0, 300) };
  }

  /** گردش انبار — COGS تقریبی / ارزش میانگین موجودی */
  async turnover(): Promise<{ days: number; turnover: number; daysOfStock: number; cogsWindow: string; avgInventoryValue: string }> {
    const days = await this.settings.get<number>("fastMoverDays");
    const since = new Date(Date.now() - days * 24 * 3600_000);
    const outs = await this.prisma.stockLedgerEntry.aggregate({
      where: { type: "SALE", createdAt: { gte: since } },
      _sum: { qtyOut: true },
    });
    const soldQty = outs._sum.qtyOut ?? 0;
    const valuation = await this.valuation();
    const totalValue = BigInt(valuation.total);
    // میانگین بهای هر واحد فروخته‌شده از CostLayerهای همان SKUها
    let cogs = 0n;
    if (soldQty > 0) {
      const salesBySku = await this.prisma.stockLedgerEntry.groupBy({
        by: ["variantSku"],
        where: { type: "SALE", createdAt: { gte: since } },
        _sum: { qtyOut: true },
      });
      for (const s of salesBySku) {
        const rows = valuation.rows.filter((r) => r.sku === s.variantSku);
        const unit = rows.length > 0 ? BigInt(rows[0].avgUnitCost) : 0n;
        cogs += unit * BigInt(s._sum.qtyOut ?? 0);
      }
    }
    const avgInventory = totalValue;
    const turnoverNum = avgInventory > 0n ? Number(cogs) / Number(avgInventory) : 0;
    return {
      days,
      turnover: Math.round(turnoverNum * 100) / 100,
      daysOfStock: turnoverNum > 0 ? Math.round(days / turnoverNum) : 0,
      cogsWindow: cogs.toString(),
      avgInventoryValue: avgInventory.toString(),
    };
  }

  /** تاریخچه تعدیل‌ها — ADJUSTMENT + CORRECTION با مرجع */
  async adjustments(q: { page?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = 50;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockLedgerEntry.findMany({
        where: { type: { in: ["ADJUSTMENT", "CORRECTION"] } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          warehouse: { select: { code: true, name: true } },
          variant: { select: { sku: true, product: { select: { name: true } } } },
          actor: { select: { name: true } },
        },
      }),
      this.prisma.stockLedgerEntry.count({ where: { type: { in: ["ADJUSTMENT", "CORRECTION"] } } }),
    ]);
    return { items, total, page, limit };
  }

  /** واریانس انبارگردانی‌های بسته‌شده — مجموع مازاد/کسری ارزش‌گذاری‌شده */
  async stocktakeVariance(): Promise<{ rows: Array<{ number: string; closedAt: string | null; surplusLines: number; shortageLines: number; surplusQty: number; shortageQty: number; surplusValue: string; shortageValue: string }> }> {
    const stocktakes = await this.prisma.stocktake.findMany({
      where: { state: "CLOSED" },
      orderBy: { closedAt: "desc" },
      take: 50,
      include: {
        items: { where: { difference: { not: 0 } }, include: { variant: { select: { sku: true, product: { select: { costPrice: true } } } } } },
      },
    });
    const rows = [];
    for (const st of stocktakes) {
      let surplusLines = 0, shortageLines = 0, surplusQty = 0, shortageQty = 0, surplusValue = 0n, shortageValue = 0n;
      for (const it of st.items) {
        const d = it.difference ?? 0;
        const cost = it.variant.product.costPrice != null ? BigInt(it.variant.product.costPrice) : 0n;
        if (d > 0) { surplusLines++; surplusQty += d; surplusValue += cost * BigInt(d); }
        else { shortageLines++; shortageQty += -d; shortageValue += cost * BigInt(-d); }
      }
      rows.push({
        number: st.number,
        closedAt: st.closedAt?.toISOString() ?? null,
        surplusLines, shortageLines, surplusQty, shortageQty,
        surplusValue: surplusValue.toString(),
        shortageValue: shortageValue.toString(),
      });
    }
    return { rows };
  }

  /** داشبورد انبار — کارت‌های خلاصه */
  async dashboard() {
    const [lowItems, heldQty, pendingTransfers, draftDamages, valuation, settings] = await Promise.all([
      this.prisma.productVariant.count({ where: { lowStockThreshold: { gt: 0 }, stockQty: { lte: 0 } } }),
      this.prisma.quarantineRecord.aggregate({ where: { state: "HELD" }, _sum: { qty: true }, _count: true }),
      this.prisma.stockTransfer.count({ where: { state: { in: ["DRAFT", "IN_TRANSIT"] } } }),
      this.prisma.damageRecord.count({ where: { state: "DRAFT" } }),
      this.valuation(),
      this.settings.getAll(),
    ]);
    return {
      lowStockVariants: lowItems,
      quarantineQty: heldQty._sum.qty ?? 0,
      quarantineRecords: heldQty._count,
      pendingTransfers,
      draftDamages,
      inventoryValue: valuation.total,
      valuationLines: valuation.rows.length,
    };
  }
}
