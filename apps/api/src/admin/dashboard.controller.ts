import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { InventoryReportsService } from "../inventory/inventory-reports.service";
import { RequirePermission } from "../auth/permissions.guard";
import { Identity } from "../auth/identity.decorator";
import type { AdminIdentity } from "../auth/auth.service";

/**
 * داشبورد مدیریت — یک نقطه تجمیع برای صفحه اول پنل.
 *
 * چرا endpoint اختصاصی (به‌جای چند فراخوانی موازی از فرانت):
 *  هر ویجت مجوز جداگانه دارد؛ اگر فرانت موازی صدا بزند، نبودِ هر مجوز
 *  کل صفحه را خراب می‌کند. اینجا هر بخش جداگانه محاسبه و در صورت نبودِ مجوز
 *  به‌صورت `null` برگردانده می‌شود تا داشبورد هر نقشی سالم رندر شود.
 *
 * همه اعداد از منبع حقیقت (دیتابیس) خوانده می‌شوند — هیچ عدد ساختگی یا صفرِ
 * جعلی وجود ندارد؛ نبودِ داده یعنی `null` نه «۰».
 */

/** سفارش‌هایی که هنوز به سرانجام نرسیده‌اند و نیاز به پیگیری دارند */
const OPEN_ORDER_STATUSES = ["PENDING", "PAID", "PROCESSING", "PACKED", "SHIPPED"] as const;

/** چک‌های تسویه‌نشده (هنوز به بانک نرسیده یا وصول نشده) */
const OPEN_CHECK_STATUSES = ["RECEIVED", "DEPOSITED", "ISSUED", "PRESENTED"] as const;

/**
 * آغاز روز به وقت تهران (Asia/Tehran) به‌صورت UTC.
 * ایران از سال ۱۴۰۱ ساعت تابستانی ندارد، پس آفست ثابت +۳:۳۰ است.
 * Prisma مقادیر DateTime را به‌صورت UTC ذخیره می‌کند، پس همین لحظه UTC
 * مرز درست برای فیلتر است.
 */
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

function tehranDayStart(now = new Date()): Date {
  const shifted = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - TEHRAN_OFFSET_MS,
  );
}

@Controller("admin/dashboard")
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventoryReports: InventoryReportsService,
  ) {}

  @Get()
  @RequirePermission("dashboard.view")
  async dashboard(@Identity() me: AdminIdentity | null) {
    const perms = me?.permissions ?? [];
    const can = (p: string): boolean => perms.includes("*") || perms.includes(p);

    const from = tehranDayStart();
    const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);

    // ── فروش امروز: سفارش‌های پرداخت‌شده + فاکتورهای POS ──────────────
    const [todayOnline, todayPos] = await Promise.all([
      this.prisma.order.aggregate({
        where: { createdAt: { gte: from, lt: to }, paymentStatus: "PAID" },
        _count: { _all: true },
        _sum: { total: true },
      }),
      this.prisma.posInvoice.aggregate({
        where: { createdAt: { gte: from, lt: to } },
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
    ]);
    const onlineTotal = todayOnline._sum.total ?? 0n;
    const posTotal = todayPos._sum.grandTotal ?? 0n;

    const today = {
      date: from.toISOString(),
      online: { count: todayOnline._count._all, total: onlineTotal.toString() },
      pos: { count: todayPos._count._all, total: posTotal.toString() },
      total: (onlineTotal + posTotal).toString(),
      invoiceCount: todayOnline._count._all + todayPos._count._all,
    };

    // ── سفارش‌های باز ────────────────────────────────────────────────
    const openOrders = can("orders.view")
      ? await this.prisma.order.groupBy({
          by: ["status"],
          where: { status: { in: [...OPEN_ORDER_STATUSES] } },
          _count: { _all: true },
        })
      : null;

    const openOrderCount = openOrders ? openOrders.reduce((n, g) => n + g._count._all, 0) : null;
    const unpaidOrders = can("orders.view")
      ? await this.prisma.order.count({
          where: { status: { in: [...OPEN_ORDER_STATUSES] }, paymentStatus: { not: "PAID" } },
        })
      : null;

    // ── ارزش موجودی ──────────────────────────────────────────────────
    const inventory = can("inventory.reports")
      ? await this.prisma.stockLedgerEntry.groupBy({
          by: ["variantSku"],
          _sum: { qtyIn: true, qtyOut: true },
        }).then(async (rows) => {
          let units = 0;
          for (const r of rows) units += (r._sum.qtyIn ?? 0) - (r._sum.qtyOut ?? 0);
          const val = await this.inventoryReports.valuation();
          return {
            value: val.total,
            skuCount: val.rows.length,
            units: Math.max(0, units),
          };
        })
      : null;

    // ── چک‌های نزدیک (۳۰ روز آینده) ────────────────────────────────
    const checks = can("checks.view")
      ? await this.prisma.check.findMany({
          where: {
            status: { in: [...OPEN_CHECK_STATUSES] },
            dueDate: { gte: from, lte: new Date(to.getTime() + 30 * 24 * 60 * 60 * 1000) },
          },
          orderBy: { dueDate: "asc" },
          take: 100,
          select: {
            id: true, number: true, bankName: true, amount: true,
            dueDate: true, direction: true, status: true,
            customer: { select: { name: true } },
            supplier: { select: { name: true } },
          },
        })
      : null;

    const checkTotal = checks ? checks.reduce((s, c) => s + c.amount, 0n) : 0n;
    const overdue = checks
      ? checks.filter((c) => new Date(c.dueDate) < new Date()).length
      : null;

    // ── آخرین سفارش‌ها ───────────────────────────────────────────────
    const recentOrders = can("orders.view")
      ? await this.prisma.order.findMany({
          orderBy: { createdAt: "desc" },
          take: 6,
          select: {
            id: true, code: true, status: true, paymentStatus: true,
            total: true, createdAt: true, guestName: true, guestMobile: true,
          },
        })
      : null;

    return {
      generatedAt: new Date().toISOString(),
      today,
      openOrders: openOrders
        ? {
            count: openOrderCount,
            unpaid: unpaidOrders,
            byStatus: Object.fromEntries(openOrders.map((g) => [g.status, g._count._all])),
          }
        : null,
      inventory,
      checks: checks
        ? {
            dueCount: checks.length,
            dueTotal: checkTotal.toString(),
            overdue,
            next: checks.slice(0, 5).map((c) => ({
              id: c.id,
              number: c.number,
              bankName: c.bankName,
              amount: c.amount.toString(),
              dueDate: c.dueDate.toISOString(),
              direction: c.direction,
              party: c.customer?.name ?? c.supplier?.name ?? "—",
            })),
          }
        : null,
      recentOrders: recentOrders?.map((o) => ({
        id: o.id,
        code: o.code,
        status: o.status,
        paymentStatus: o.paymentStatus,
        total: o.total.toString(),
        createdAt: o.createdAt.toISOString(),
        customer: o.guestName ?? o.guestMobile ?? "—",
      })) ?? null,
    };
  }
}
