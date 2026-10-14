import { Controller, Get, Query } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RequirePermission } from "../auth/permissions.guard";

/**
 * گزارش سود واقعی — مأموریت ③.
 * فقط از منبع حقیقت: اسناد GL سفارش‌ها + بهای میانگین دفتر انبار
 * (StockLedgerEntry.unitCost روی INهای بهایی). هیچ عدد ساختگی —
 * بهای ثبت‌نشده صادقانه null است تا «سود صفر» گمراه‌کننده نباشد.
 */
const REVENUE_ACCOUNT = "4000"; // فروش
const COGS_ACCOUNT = "5000"; // بهای تمام‌شدهٔ فروش
const EXPENSE_ROOT = "6"; // کلاس هزینه‌ها (6000 حقوق و …)

@Controller("admin/reports")
export class ProfitController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("profit")
  @RequirePermission("accounting.reports")
  async profit(@Query() q: { from?: string; to?: string }) {
    const to = q.to ? new Date(q.to) : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 24 * 3600 * 1000);

    // 1) فروش و بهای تمام‌شدهٔ اسناد واقعی سفارش‌ها — از JournalLine (یک منبع حقیقت)
    const accounts = await this.prisma.account.findMany();
    const byCode = new Map(accounts.map((a) => [a.code, a.id]));
    const revId = byCode.get(REVENUE_ACCOUNT);
    const cogsId = byCode.get(COGS_ACCOUNT);
    const expenseIds = accounts.filter((a) => a.code.startsWith(EXPENSE_ROOT)).map((a) => a.id);

    const lines = await this.prisma.journalLine.findMany({
      where: {
        // F0-2: سند مکمل COGS (sourceType=`order-cogs-backfill`) هم باید در
        // KPI دیده شود؛ وگرنه جدول بهای را می‌داند ولی عدد کلی عقب می‌ماند.
        entry: { date: { gte: from, lte: to }, sourceType: { in: ["order", "order-cogs-backfill"] } },
        accountId: { in: [revId, cogsId, ...expenseIds].filter((x): x is string => Boolean(x)) },
      },
      select: { accountId: true, debit: true, credit: true },
    });
    let revenue = 0n;
    let cogs = 0n;
    let orderExpenses = 0n;
    for (const l of lines) {
      if (l.accountId === revId) revenue += (l.credit ?? 0n) - (l.debit ?? 0n);
      else if (l.accountId === cogsId) cogs += (l.debit ?? 0n) - (l.credit ?? 0n);
      else if (expenseIds.includes(l.accountId)) orderExpenses += (l.debit ?? 0n) - (l.credit ?? 0n);
    }

    // 2) سود هر SKU/سفارش — قیمت فروش واقعی + بهای میانگین دفتر انبار
    const orders = await this.prisma.order.findMany({
      where: { paymentStatus: "PAID", createdAt: { gte: from, lte: to } },
      select: {
        id: true, code: true, createdAt: true, total: true,
        items: {
          select: {
            qty: true, lineTotal: true,
            variant: { select: { sku: true, product: { select: { name: true } } } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const perSku = new Map<string, { sku: string; name: string; qty: number; revenue: bigint; cogs: bigint | null }>();
    const perOrder: Array<{ code: string; createdAt: Date; revenue: string; cogs: string | null; profit: string | null }> = [];
    const missingCostSkus = new Set<string>();

    for (const o of orders) {
      let orderCogs = 0n;
      let orderHasCost = o.items.length > 0;
      for (const it of o.items) {
        const sku = it.variant?.sku ?? "—";
        const wac = await this.wac(sku);
        const cur = perSku.get(sku) ?? { sku, name: it.variant?.product?.name ?? "—", qty: 0, revenue: 0n, cogs: null };
        cur.qty += it.qty;
        cur.revenue += it.lineTotal;
        if (wac != null) {
          cur.cogs = (cur.cogs ?? 0n) + wac * BigInt(it.qty);
          orderCogs += wac * BigInt(it.qty);
        } else {
          orderHasCost = false;
          missingCostSkus.add(sku);
        }
        perSku.set(sku, cur);
      }
      perOrder.push({
        code: o.code,
        createdAt: o.createdAt,
        revenue: o.total.toString(),
        cogs: orderHasCost ? orderCogs.toString() : null,
        profit: orderHasCost ? (o.total - orderCogs).toString() : null,
      });
    }

    const skuRows = [...perSku.values()]
      .map((r) => ({
        sku: r.sku,
        name: r.name,
        qty: r.qty,
        revenue: r.revenue.toString(),
        cogs: r.cogs?.toString() ?? null,
        profit: r.cogs != null ? (r.revenue - r.cogs).toString() : null,
      }))
      .sort((a, b) => Number(b.revenue) - Number(a.revenue));

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      // اعداد کلی فقط از اسناد GL — سود ناخالص/خالص واقعی
      revenue: revenue.toString(),
      cogs: cogs.toString(),
      grossProfit: (revenue - cogs).toString(),
      expenses: orderExpenses.toString(),
      netProfit: (revenue - cogs - orderExpenses).toString(),
      grossMargin: revenue > 0n ? Number(((revenue - cogs) * 10000n) / revenue) / 100 : null,
      netMargin: revenue > 0n ? Number(((revenue - cogs - orderExpenses) * 10000n) / revenue) / 100 : null,
      // جزئیات SKU/سفارش از قیمت فروش واقعی + بهای میانگین انبار
      itemsTotal: orders.length,
      itemsWithCost: perOrder.filter((p) => p.cogs != null).length,
      itemsMissingCost: perOrder.filter((p) => p.cogs == null).length,
      missingCostSkus: [...missingCostSkus],
      perSku: skuRows,
      perOrder: perOrder.slice(0, 50),
    };
  }

  /** بهای میانگین وزنی SKU از حرکت‌های بهایی دفتر انبار؛ بدون بهای ثبت‌شده → null (صادقانه) */
  private async wac(sku: string): Promise<bigint | null> {
    if (!sku) return null;
    const rows = await this.prisma.stockLedgerEntry.findMany({
      where: { variantSku: sku, type: { in: ["OPENING", "PURCHASE"] }, unitCost: { not: null } },
      select: { qtyIn: true, unitCost: true },
    });
    let totalQty = 0;
    let totalCost = 0n;
    for (const r of rows) {
      totalQty += r.qtyIn;
      totalCost += (r.unitCost ?? 0n) * BigInt(r.qtyIn);
    }
    return totalQty > 0 ? totalCost / BigInt(totalQty) : null;
  }
}
