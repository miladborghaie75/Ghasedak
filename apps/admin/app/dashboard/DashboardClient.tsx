"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";
import {
  BarList,
  CHART_COLORS,
  ChartEmpty,
  LineChart,
  RangePicker,
  SeriesTable,
  StatCard,
  fa,
} from "@/components/charts";

/**
 * داشبورد مدیریتی (فاز ۷).
 *
 * سه اصل که رعایت شده:
 *
 * ۱) **همهٔ اعداد از دفتر کل می‌آیند** — نه از جدول‌های عملیاتی. پس نمودار با
 *    تراز آزمایشی می‌خواند. اگر روزی نخواند، یعنی جایی در ثبت سند ایراد است
 *    و باید همان‌جا درست شود، نه اینکه نمودار دستی هماهنگ شود.
 *
 * ۲) **گزارش‌های مرتبط روی یک نمودار.** فروش و بها و سود سه خط جدا هستند با
 *    یک مقیاس، چون جدا دیدنشان گمراه‌کننده است: فروش بالا با سود پایین یعنی
 *    مشکل قیمت‌گذاری، و این با نمودار جدا معلوم نمی‌شود.
 *
 * ۳) **نبودِ داده، صفر نیست.** اگر داده‌ای نیست «داده‌ای ثبت نشده» گفته
 *    می‌شود — چون صفر یعنی «فروش نداشتیم» و خالی یعنی «هنوز چیزی ثبت نشده».
 *    این دو برای تصمیم‌گیری فرق دارند.
 */

interface TrendPoint {
  period: string;
  revenue: number;
  cogs: number;
  profit: number;
  margin: number | null;
  returns: number;
  shipping: number;
}
interface TrendResult {
  range: { from: string; to: string };
  granularity: "day" | "month";
  points: TrendPoint[];
  totals: { revenue: number; cogs: number; profit: number };
}
interface ChannelRow {
  id: string;
  name: string;
  type: string;
  total: number;
  count: number;
  share: number | null;
}
interface ExpenseRow {
  code: string;
  name: string;
  amount: number;
  share: number | null;
}
interface Overview {
  cards: {
    cash: number;
    receivable: number;
    payable: number;
    netWorth: number;
    inventoryValue: number;
    inventoryGap: number;
    todayRevenue: number;
  };
  alerts: {
    checksOverdue: { count: number; amount: number };
    checksDueSoon: { count: number; amount: number };
    receivablesOverdue: number;
    payablesOverdue: number;
    unsettledGateway: number;
    bankMismatch: number;
    warehouseMismatch: number;
    inventoryUnknownCost: number | null;
  };
}
interface CashPoint {
  period: string;
  inflow: number;
  outflow: number;
  balance: number;
}

type Tab = "overview" | "trend" | "channels" | "expenses" | "cash";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "نگاه کلی" },
  { key: "trend", label: "روند فروش و سود" },
  { key: "channels", label: "فروش بر حسب کانال" },
  { key: "expenses", label: "ساختار هزینه" },
  { key: "cash", label: "جریان نقدی" },
];

export default function DashboardClient() {
  const { call, loading } = useAdminApi();
  const [tab, setTab] = useState<Tab>("overview");
  const [range, setRange] = useState(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - 90);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
      preset: "90d",
    };
  });

  const [trend, setTrend] = useState<TrendResult | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [channelTotal, setChannelTotal] = useState(0);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [expenseBreakdown, setExpenseBreakdown] = useState(false);
  const [cash, setCash] = useState<CashPoint[]>([]);
  const [cashOpen, setCashOpen] = useState(0);
  const [cashClose, setCashClose] = useState(0);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const q = `?from=${range.from}&to=${range.to}`;
    const [t, c, e, n, o] = await Promise.all([
      call<TrendResult>(`/admin/accounting/dashboard/trend${q}`),
      call<{ items: ChannelRow[]; total: number }>(`/admin/accounting/dashboard/channels${q}`),
      call<{ items: ExpenseRow[]; total: number; breakdownAvailable: boolean }>(
        `/admin/accounting/dashboard/expenses${q}`,
      ),
      call<{ points: CashPoint[]; openingBalance: number; closingBalance: number }>(
        `/admin/accounting/dashboard/cash-flow${q}`,
      ),
      call<Overview>("/admin/accounting/dashboard/overview"),
    ]);

    if (t.ok && t.data) setTrend(t.data);
    else setError(t.error?.message ?? "خطا در روند");
    if (c.ok && c.data) {
      setChannels(c.data.items);
      setChannelTotal(c.data.total);
    }
    if (e.ok && e.data) {
      setExpenses(e.data.items);
      setExpenseTotal(e.data.total);
      setExpenseBreakdown(e.data.breakdownAvailable);
    }
    if (n.ok && n.data) {
      setCash(n.data.points);
      setCashOpen(n.data.openingBalance);
      setCashClose(n.data.closingBalance);
    }
    if (o.ok && o.data) setOverview(o.data);
  }, [call, range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const trendSeries = useMemo(
    () => [
      { key: "rev", label: "فروش", color: CHART_COLORS.revenue, points: trend?.points.map((p) => p.revenue) ?? [] },
      { key: "cogs", label: "بهای تمام‌شده", color: CHART_COLORS.cogs, points: trend?.points.map((p) => p.cogs) ?? [] },
      { key: "pro", label: "سود ناخالص", color: CHART_COLORS.profit, points: trend?.points.map((p) => p.profit) ?? [] },
    ],
    [trend],
  );

  const trendLabels = useMemo(
    () => trend?.points.map((p) => formatPeriod(p.period, trend.granularity)) ?? [],
    [trend],
  );

  const hasRevenue = (trend?.totals.revenue ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* تب‌ها + بازه */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap overflow-hidden rounded-xl border border-app-line">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`h-9 px-4 text-[11px] font-bold ${
                tab === t.key ? "bg-primary text-on-accent" : "bg-surface text-app-muted"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab !== "overview" && (
          <RangePicker
            from={range.from}
            to={range.to}
            preset={range.preset}
            onChange={(r) => setRange(r)}
          />
        )}
      </div>

      {error && (
        <p className="rounded-xl bg-app-err/10 px-4 py-2 text-xs font-bold text-app-err">{error}</p>
      )}
      {loading && <p className="text-[11px] text-app-muted">در حال محاسبه…</p>}

      {/* ══════════ نگاه کلی ══════════ */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard label="نقد (بانک + صندوق)" value={fa(overview?.cards.cash)} />
            <StatCard label="طلب از مشتری" value={fa(overview?.cards.receivable)} sub={`سررسیدگذشته ${fa(overview?.alerts.receivablesOverdue)}`} tone={(overview?.alerts.receivablesOverdue ?? 0) > 0 ? "warn" : "ok"} href="/reports" />
            <StatCard label="بدهی به تأمین‌کننده" value={fa(overview?.cards.payable)} />
            <StatCard label="ارزش موجودی انبار" value={fa(overview?.cards.inventoryValue)} sub={`اختلاف با دفتر کالا ${fa(overview?.cards.inventoryGap)}`} tone={(overview?.alerts.warehouseMismatch ?? 0) > 0 ? "warn" : "ok"} href="/reports" />
          </div>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard label="فروش امروز" value={fa(overview?.cards.todayRevenue)} />
            <StatCard label="سرمایه خالص" value={fa(overview?.cards.netWorth)} />
            <StatCard label="سود کل بازه" value={fa(trend?.totals.profit)} sub={`فروش ${fa(trend?.totals.revenue)}`} tone={(trend?.totals.profit ?? 0) < 0 ? "err" : "ok"} />
            <StatCard
              label="پول نزد درگاه (تسویه‌نشده)"
              value={fa(overview?.alerts.unsettledGateway)}
              tone={(overview?.alerts.unsettledGateway ?? 0) > 0 ? "warn" : "ok"}
            />
          </div>

          {/* هشدارها — فقط چیزهایی که واقعاً نیاز به اقدام دارند */}
          <Alerts alerts={overview?.alerts} />
        </div>
      )}

      {/* ══════════ روند ══════════ */}
      {tab === "trend" && (
        <section className="rounded-card border border-app-line bg-surface p-4">
          <h3 className="mb-3 text-xs font-black">فروش، بها و سود</h3>
          {trend && hasRevenue ? (
            <>
              <LineChart
                labels={trendLabels}
                series={trendSeries}
                ariaLabel="نمودار روند فروش، بهای تمام‌شده و سود ناخالص"
              />
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] font-bold text-app-muted">
                  نمایش به‌صورت جدول
                </summary>
                <SeriesTable labels={trendLabels} series={trendSeries} />
              </details>
              <p className="mt-2 text-[10px] text-app-muted">
                تفکیک‌بندی: {trend.granularity === "month" ? "ماهانه" : "روزانه"} — برای بازه‌های
                بالای ۱۲۰ روز خودکار ماهانه می‌شود تا نمودار خوانا بماند.
              </p>
            </>
          ) : (
            <ChartEmpty reason="برای این بازه فروشی ثبت نشده است. به‌محض ثبت اولین سند فروش، نمودار پر می‌شود." />
          )}
        </section>
      )}

      {/* ══════════ کانال ══════════ */}
      {tab === "channels" && (
        <section className="rounded-card border border-app-line bg-surface p-4">
          <h3 className="mb-3 text-xs font-black">فروش بر حسب کانال</h3>
          {channels.length === 0 ? (
            <ChartEmpty reason="هنوز فاکتوری با کانال مشخص ثبت نشده است." />
          ) : (
            <>
              <BarList
                items={channels.map((c) => ({ label: c.name, value: c.total, share: c.share }))}
                ariaLabel="نمودار فروش بر حسب کانال"
              />
              <p className="mt-3 text-[11px] text-app-muted">
                جمع کل: {fa(channelTotal)}
              </p>
            </>
          )}
        </section>
      )}

      {/* ══════════ ساختار هزینه ══════════ */}
      {tab === "expenses" && (
        <section className="rounded-card border border-app-line bg-surface p-4">
          <h3 className="mb-3 text-xs font-black">ساختار هزینه‌ها</h3>
          {expenses.length === 0 ? (
            <ChartEmpty reason="در این بازه هزینه‌ای ثبت نشده است." />
          ) : (
            <>
              <BarList
                items={expenses.map((e) => ({ label: `${e.code} — ${e.name}`, value: e.amount, share: e.share }))}
                ariaLabel="نمودار ساختار هزینه‌ها"
              />
              <p className="mt-3 text-[11px] text-app-muted">جمع: {fa(expenseTotal)}</p>
              {!expenseBreakdown && (
                <p className="mt-2 rounded-xl bg-app-warning/10 px-3 py-2 text-[11px] leading-5 text-app-warning">
                  تفکیک هزینه‌ها هنوز کامل نشده: بیشتر هزینه‌ها در حساب عمومی{" "}
                  <span dir="ltr">6000</span> ثبت شده‌اند. تا وقتی سندها روی
                  زیرحساب‌های تفکیکی بنشینند، این نمودار فقط یک ستون بزرگ نشان می‌دهد و
                  نمی‌گوید پول کجا رفته.
                </p>
              )}
            </>
          )}
        </section>
      )}

      {/* ══════════ جریان نقدی ══════════ */}
      {tab === "cash" && (
        <section className="rounded-card border border-app-line bg-surface p-4">
          <h3 className="mb-3 text-xs font-black">جریان نقدی</h3>
          {cash.length === 0 ? (
            <ChartEmpty reason="در این بازه گردش نقدی ثبت نشده است." />
          ) : (
            <>
              <div className="mb-3 grid grid-cols-3 gap-2">
                <StatCard label="اول دوره" value={fa(cashOpen)} tone="plain" />
                <StatCard
                  label="تغییر دوره"
                  value={fa(cashClose - cashOpen)}
                  tone={cashClose - cashOpen < 0 ? "err" : "ok"}
                />
                <StatCard label="پایان دوره" value={fa(cashClose)} tone="plain" />
              </div>
              <LineChart
                labels={cash.map((p) => formatPeriod(p.period, cash.length > 120 ? "month" : "day"))}
                series={[
                  { key: "in", label: "ورودی", color: CHART_COLORS.profit, points: cash.map((p) => p.inflow) },
                  { key: "out", label: "خروجی", color: CHART_COLORS.cogs, points: cash.map((p) => p.outflow) },
                ]}
                ariaLabel="نمودار ورودی و خروجی نقد"
              />
            </>
          )}
        </section>
      )}
    </div>
  );
}

/** جدول هشدار — فقط مواردی که نیاز به اقدام دارند */
function Alerts({ alerts }: { alerts: Overview["alerts"] | undefined }) {
  if (!alerts) return null;
  const rows: Array<{ label: string; value: string; tone: "ok" | "warn" | "err"; href?: string }> = [];

  if (alerts.checksOverdue.count > 0) {
    rows.push({
      label: "چک‌های سررسیدگذشته",
      value: `${fa(alerts.checksOverdue.count)} فقره — ${fa(alerts.checksOverdue.amount)}`,
      tone: "err",
      href: "/reports",
    });
  }
  if (alerts.checksDueSoon.count > 0) {
    rows.push({
      label: "چک‌های نزدیک سررسید (۳۰ روز)",
      value: `${fa(alerts.checksDueSoon.count)} فقره — ${fa(alerts.checksDueSoon.amount)}`,
      tone: "warn",
      href: "/reports",
    });
  }
  if (alerts.receivablesOverdue > 0) {
    rows.push({
      label: "طلب سررسیدگذشته از مشتری",
      value: fa(alerts.receivablesOverdue),
      tone: "warn",
      href: "/reports",
    });
  }
  if (alerts.unsettledGateway > 0) {
    rows.push({
      label: "پول نزد درگاه، تسویه‌نشده",
      value: fa(alerts.unsettledGateway),
      tone: "warn",
      href: "/settlements",
    });
  }
  if (alerts.warehouseMismatch > 0) {
    rows.push({
      label: "انباری که دفتر و انبارش نمی‌خواند",
      value: `${fa(alerts.warehouseMismatch)} انبار`,
      tone: "warn",
      href: "/reports",
    });
  }
  if (alerts.bankMismatch > 0) {
    rows.push({
      label: "حساب بانکی با مغایرت",
      value: `${fa(alerts.bankMismatch)} حساب`,
      tone: "warn",
      href: "/reports",
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-app-ok/40 bg-app-ok/5 p-4">
        <p className="text-xs font-bold text-app-ok">هیچ مورد نیازمند اقدام فوری وجود ندارد.</p>
        <p className="mt-1 text-[11px] text-app-muted">
          چک سررسیدگذشته، بدهی معوق و مغایرت بانکی بررسی شدند.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-card border border-app-line bg-surface">
      <h3 className="border-b border-app-line px-4 py-3 text-xs font-black">نیازمند پیگیری</h3>
      <ul className="divide-y divide-app-line/60">
        {rows.map((r) => (
          <li key={r.label}>
            {r.href ? (
              <a href={r.href} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-app-bg">
                <span className="text-[11px] text-ink">{r.label}</span>
                <span className={`text-[11px] font-bold tabular-nums ${r.tone === "err" ? "text-app-err" : "text-app-warning"}`}>
                  {r.value} ←
                </span>
              </a>
            ) : (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-[11px] text-ink">{r.label}</span>
                <span className="text-[11px] font-bold tabular-nums text-app-warning">{r.value}</span>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** برچسب دوره: ماهانه «اسفند» روزانه «۱۴۰۴/۰۵/۱۲» */
function formatPeriod(p: string, granularity: "day" | "month"): string {
  if (granularity === "month") {
    const [y, m] = p.split("-");
    const names = ["ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن", "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر"];
    const idx = Number(m) - 1;
    return names[idx] ?? p;
  }
  return p.slice(8) === "01" ? p.slice(5, 7) : p.slice(8);
}