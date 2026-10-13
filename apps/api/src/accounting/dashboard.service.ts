import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ReportsService } from "./reports.service";

/**
 * دادهٔ نمودارها و جدول‌های داشبورد مدیریتی (فاز ۷).
 *
 * قاعدهٔ مهم: همهٔ اعداد مالی از `JournalLine` (دفتر کل) خوانده می‌شوند،
 * نه از جدول‌های عملیاتی. دلیل: اگر نمودار با تراز آزمایشی نخواند، یعنی
 * جایی در ثبت سند ایراد است — و آن ایراد باید پیدا شود، نه اینکه نمودار را
 * دستی هماهنگ کنیم.
 *
 * دربارهٔ «صادق بودن»: اگر داده‌ای نباشد، `null` برمی‌گردانیم نه صفر. نموداری
 * که خط صفر نشان می‌دهد یعنی «فروش نداشتیم»، ولی نموداری که خالی است یعنی
 * «داده‌ای نیست» — این دو خیلی فرق دارند برای تصمیم‌گیری.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  /**
   * روند روزانه/ماهانهٔ فروش، بها و سود.
   *
   * سه خط روی یک نمودار چون به هم وابسته‌اند: فروش بالا با سود پایین یعنی
   * مشکل قیمت‌گذاری یا خرید — و این با دیدن جداگانه معلوم نمی‌شود.
   *
   * `granularity`:
   *   `day`   — برای بازهٔ کوتاه (۷ تا ۹۰ روز)
   *   `month` — برای بازهٔ بلند (سال به بالا)
   *   `auto`  — بر اساس طول بازه تصمیم می‌گیرد
   */
  async trend(
    from?: string,
    to?: string,
    granularity: "day" | "month" | "auto" = "auto",
  ) {
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : defaultStart(toDate);
    const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000));
    const g: "day" | "month" = granularity === "auto" ? (days > 120 ? "month" : "day") : granularity;

    // سطرهای سند از دفتر کل — تنها منبع حقیقت
    const lines = await this.prisma.journalLine.findMany({
      where: {
        entry: { state: "FINAL", date: { gte: fromDate, lte: toDate } },
        account: { code: { in: ["4000", "5000", "4000-01", "4000-02", "5000-01", "5000-02", "5000-03"] } },
      },
      include: { account: { select: { code: true } } },
      take: 50_000,
    });

    const buckets = new Map<string, { revenue: number; cogs: number; returns: number; shipping: number }>();
    const key = (d: Date) =>
      g === "month" ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10);

    // همهٔ بازه پر می‌شود تا نمودار روزهای بدون فروش را هم نشان دهد
    for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + (g === "month" ? 0 : 1))) {
      if (g === "month") d.setUTCMonth(d.getUTCMonth() + 1);
      buckets.set(key(d), { revenue: 0, cogs: 0, returns: 0, shipping: 0 });
    }

    for (const l of lines) {
      const e = await this.entryDate(l.entryId);
      if (!e) continue;
      const k = key(e);
      const row = buckets.get(k);
      if (!row) continue;
      const amt = Number(l.credit) - Number(l.debit); // درآمد/بها ریاضی‌وار مثبت است
      if (l.account.code === "4000") row.revenue += amt;
      else if (l.account.code === "4000-01") row.returns += Math.abs(amt);
      else if (l.account.code === "4000-02") row.shipping += amt;
      else if (l.account.code.startsWith("5000")) row.cogs += amt;
    }

    const points = [...buckets.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => ({
        period: k,
        revenue: v.revenue,
        cogs: v.cogs,
        // سود خالص یعنی فروش منهای بهای تمام‌شده (تخفیف و ارسال جدا نگه داشته شده‌اند)
        profit: v.revenue - v.cogs,
        margin: v.revenue > 0 ? (v.revenue - v.cogs) / v.revenue : null,
        returns: v.returns,
        shipping: v.shipping,
      }));

    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      granularity: g,
      points,
      totals: {
        revenue: points.reduce((s, p) => s + p.revenue, 0),
        cogs: points.reduce((s, p) => s + p.cogs, 0),
        profit: points.reduce((s, p) => s + p.profit, 0),
      },
    };
  }

  /**
   * فروش به تفکیک کانال (آنلاین / حضوری).
   *
   * از `SalesChannel` خوانده می‌شود نه از `Order.channelId` تنها، چون سفارش
   * می‌تواند کانال نداشته باشد و آن‌وقت در هیچ گروهی نمی‌افتد و در نمودار
   * گم می‌شود — که بدترین نوع خطاست در گزارش مدیریتی.
   */
  async byChannel(from?: string, to?: string) {
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : defaultStart(toDate);
    const where = {
      state: "FINALIZED" as const,
      createdAt: { gte: fromDate, lte: toDate },
    };

    const channels = await this.prisma.salesChannel.findMany({
      select: { id: true, name: true, type: true },
    });
    const channelById = new Map(channels.map((c) => [c.id, c]));

    const [pos, orders] = await Promise.all([
      this.prisma.posInvoice.findMany({ where, select: { grandTotal: true, channelId: true } }),
      this.prisma.order.findMany({
        where: { paymentStatus: "PAID", createdAt: { gte: fromDate, lte: toDate } },
        select: { total: true, channelId: true },
      }),
    ]);

    const map = new Map<string, { id: string; name: string; type: string; total: number; count: number }>();
    const bump = (id: string | null | undefined, name: string, type: string, total: number) => {
      const keyId = id ?? "none";
      const row = map.get(keyId) ?? { id: keyId, name, type, total: 0, count: 0 };
      row.total += total;
      row.count += 1;
      map.set(keyId, row);
    };

    for (const p of pos) {
      const ch = p.channelId ? channelById.get(p.channelId) : null;
      bump(p.channelId, ch?.name ?? "حضوری (بدون کانال)", ch?.type ?? "pos", Number(p.grandTotal ?? 0));
    }
    for (const o of orders) {
      const ch = o.channelId ? channelById.get(o.channelId) : null;
      bump(o.channelId, ch?.name ?? "آنلاین (بدون کانال)", ch?.type ?? "online", Number(o.total ?? 0));
    }

    const rows = [...map.values()].sort((a, b) => b.total - a.total);
    const grand = rows.reduce((s, r) => s + r.total, 0);
    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      items: rows.map((r) => ({ ...r, share: grand > 0 ? r.total / grand : null })),
      total: grand,
    };
  }

  /**
   * ساختار هزینه‌ها — پرکاربردترین نمودار برای تصمیم مدیریتی.
   *
   * فقط وقتی معنا دارد که حساب‌ها تفکیک شده باشند (فاز ۰٫۳). قبلاً همهٔ
   * هزینه‌ها در `6000` یکی بودند و این نمودار یک ستون بی‌معنا می‌شد.
   * اگر تفکیک نشده باشد `breakdownAvailable: false` برمی‌گردد تا UI صادقانه
   * «هنوز تفکیک نشده» بگوید به‌جای نمودار گمراه‌کننده.
   */
  async expenseStructure(from?: string, to?: string) {
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : defaultStart(toDate);

    const lines = await this.prisma.journalLine.findMany({
      where: {
        entry: { state: "FINAL", date: { gte: fromDate, lte: toDate } },
        account: { type: "EXPENSE" },
      },
      include: { account: { select: { code: true, name: true } } },
      take: 50_000,
    });

    const map = new Map<string, { code: string; name: string; amount: number }>();
    for (const l of lines) {
      const amt = Number(l.debit) - Number(l.credit);
      if (amt <= 0) continue;
      const row = map.get(l.account.code) ?? { code: l.account.code, name: l.account.name, amount: 0 };
      row.amount += amt;
      map.set(l.account.code, row);
    }

    const items = [...map.values()].sort((a, b) => b.amount - a.amount);
    const total = items.reduce((s, r) => s + r.amount, 0);

    // تفکیک فقط وقتی واقعی است که بیش از یک زیرحساب هزینه استفاده شده باشد
    const distinctGroups = new Set(items.map((i) => i.code.split("-")[0])).size;
    const breakdownAvailable = items.filter((i) => i.code.includes("-")).length >= 2;

    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      items: items.map((i) => ({ ...i, share: total > 0 ? i.amount / total : null })),
      total,
      breakdownAvailable,
      groupCount: distinctGroups,
    };
  }

  /**
   * جریان نقدی — ورود و خروج واقعی پول.
   *
   * از ماندهٔ حساب‌های نقد (۱۰۰۰ و زیرحساب‌هایش + ۱۱۰۰ و زیرحساب‌هایش)
   * خوانده می‌شود، چون «نقد» فقط همین‌هاست — نه کل دارایی‌ها.
   *
   * نکتهٔ محاسبه: موجودی هر نقطه **انباشته** است (نه گردش همان بازه)، و
   * `openingBalance` از جمع کل پیش از شروع بازه می‌آید — نه از نقطهٔ اول.
   * اگر از نقطهٔ اول گرفته شود و بازه ناقص باشد، عدد با دفتر نمی‌خواند.
   */
  async cashFlowTrend(from?: string, to?: string) {
    const toDate = to ? new Date(`${to}T23:59:59.999Z`) : new Date();
    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : defaultStart(toDate);
    const days = Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000));
    const g: "day" | "month" = days > 120 ? "month" : "day";
    const bucketKey = (d: Date) => (g === "month" ? d.toISOString().slice(0, 7) : d.toISOString().slice(0, 10));

    const lines = await this.prisma.journalLine.findMany({
      // گروه + زیرحساب (مثل `1100-01`)
      where: {
        entry: { state: "FINAL" },
        account: {
          OR: [
            { code: { in: CASH_CODES } },
            { code: { startsWith: "1000-" } },
            { code: { startsWith: "1100-" } },
          ],
        },
      },      include: { account: { select: { code: true } }, entry: { select: { date: true } } },
      take: 50_000,
    });

    // آغاز بازه و آغاز هر نقطه — برای محاسبهٔ گردش و انباشت
    const buckets = new Map<string, { inflow: number; outflow: number; balance: number }>();
    for (let d = new Date(fromDate); d <= toDate; d.setUTCDate(d.getUTCDate() + 1)) {
      const k = bucketKey(d);
      if (!buckets.has(k)) buckets.set(k, { inflow: 0, outflow: 0, balance: 0 });
      // ماهانه: یک‌بار کافی است، ولی تکرار بی‌ضرر است
      if (g === "day") continue;
    }

    // موجودی پیش از شروع بازه (پایهٔ نمودار)
    const openingBalance = lines
      .filter((l) => l.entry.date < fromDate)
      .reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);

    let running = openingBalance;
    const keys = [...buckets.keys()].sort();
    for (const k of keys) {
      const row = buckets.get(k)!;
      for (const l of lines) {
        if (bucketKey(l.entry.date) !== k) continue;
        const d = Number(l.debit) - Number(l.credit);
        if (d > 0) row.inflow += d;
        else row.outflow += -d;
      }
      // گردش خالص این بازه به موجودی انباشته اضافه می‌شود
      running += row.inflow - row.outflow;
      row.balance = running;
    }

    const points = keys.map((k) => ({ period: k, ...buckets.get(k)! }));
    return {
      range: { from: fromDate.toISOString(), to: toDate.toISOString() },
      granularity: g,
      points,
      openingBalance,
      closingBalance: running,
    };
  }

  /**
   * کارت‌های وضعیت + جدول‌های هشدار.
   *
   * همه از همان endpointهای گزارش فاز ۵/۶ خوانده می‌شوند تا داشبورد و
   * گزارش‌ها **یک عدد** نشان دهند — نه دو عدد متفاوت در دو صفحه.
   */
  async overview() {
    const [checksDue, arAp, warehouses, bank, settlement, todayRevenue] = await Promise.all([
      this.reports.checksDue(30),
      this.reports.receivablesPayables(),
      this.warehouseValuation(),
      this.reports.bankReconciliation(),
      this.settlementSummary(),
      this.todayRevenue(),
    ]);

    const book = warehouses.totals.bookValue;
    const inv = warehouses.totals.inventoryValue;

    // کالاهایی که بهای تمام‌شده‌شان ثبت نشده ⇒ سودشان قابل اتکا نیست.
    // شمارش از خود واریانت‌ها می‌آید چون `costPrice` روی `Product` است و
    // دفتر کالا به واریانت وصل نیست.
    const unknownCost = await this.prisma.productVariant.count({
      where: { product: { deletedAt: null, costPrice: null }, stockQty: { gt: 0 } },
    });

    return {
      cards: {
        cash: bank.accounts.reduce((s, a) => s + a.bookBalance, 0),
        receivable: arAp.receivables.total,
        payable: arAp.payables.total,
        netWorth: book - arAp.payables.total,
        inventoryValue: book,
        inventoryGap: book - inv,
        todayRevenue,
      },
      alerts: {
        // هشدارهایی که واقعاً نیاز به اقدام دارند — نه هشدار تزئینی
        checksOverdue: { count: checksDue.overdue.count, amount: checksDue.overdue.total },
        checksDueSoon: { count: checksDue.dueSoon.count, amount: checksDue.dueSoon.total },
        receivablesOverdue: arAp.receivables.overdueTotal,
        payablesOverdue: arAp.payables.overdueTotal,
        unsettledGateway: settlement.unsettledAmount,
        bankMismatch: bank.mismatched,
        warehouseMismatch: warehouses.totals.needsAttention,
        inventoryUnknownCost: unknownCost,
      },
    };
  }

  /** خلاصهٔ تسویه — از سرویس فاز ۲٫۵ تا داشبورد و گزارش‌ها یکی بماند */
  private async settlementSummary() {
    const pending = await this.prisma.paymentAttempt.findMany({
      where: { state: "PAID", settlementBatchId: null, providerId: { not: null } },
      select: { amount: true },
      take: 20_000,
    });
    return {
      unsettledAmount: pending.reduce((s, r) => s + Number(r.amount), 0),
      unsettledCount: pending.length,
    };
  }

  /** فروش امروز از هر دو کانال */
  private async todayRevenue() {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);

    const [pos, online] = await Promise.all([
      this.prisma.posInvoice.findMany({
        where: { state: "FINALIZED", createdAt: { gte: start, lte: end } },
        select: { grandTotal: true },
      }),
      this.prisma.order.findMany({
        where: { paymentStatus: "PAID", createdAt: { gte: start, lte: end } },
        select: { total: true },
      }),
    ]);
    return (
      pos.reduce((s, p) => s + Number(p.grandTotal ?? 0), 0) +
      online.reduce((s, o) => s + Number(o.total ?? 0), 0)
    );
  }

  /** کمکی: تاریخ سند از روی شناسه — برای گروه‌بندی نمودار */
  private async entryDate(entryId: string): Promise<Date | null> {
    if (this._entryDates.has(entryId)) return this._entryDates.get(entryId)!;
    const e = await this.prisma.journalEntry.findUnique({ where: { id: entryId }, select: { date: true } });
    if (e) this._entryDates.set(entryId, e.date);
    return e?.date ?? null;
  }
  private _entryDates = new Map<string, Date>();

  async warehouseValuation(from?: string, to?: string) {
    return this.reports.warehouseValuation(from, to);
  }
}

/**
 * حساب‌های نقد و بانک (گروه + زیرحساب‌ها) — یعنی هر چه واقعاً پول است.
 *
 * زیرحساب‌ها لازم‌اند چون از فاز ۶ هر صندوق و بانک حساب مستقل دارد
 * (`1100-01` و…)؛ بدون آن‌ها، جریان نقدی ناقص می‌شد.
 */
const CASH_CODES = ["1000", "1100"];

/** پیشوند حساب‌های نقد — برای شرط `startsWith` روی زیرحساب‌ها */
const CASH_PREFIXES = ["1000", "1100"];

/** شروع پیش‌فرض بازه: ۹۰ روز اخیر — هم روند روزانه را می‌دهد هم خواناست */
function defaultStart(to: Date): Date {
  const d = new Date(to);
  d.setUTCDate(d.getUTCDate() - 90);
  return d;
}