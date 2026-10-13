"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

/**
 * گزارش‌های مدیریتی (فاز ۵) — صفحهٔ مستقل.
 *
 * هر گزارش یک تب است تا صفحه شلوغ نشود: کاربر گزارشی را که می‌خواهد
 * باز می‌کند، نه اینکه چهار جدول را یک‌جا ببیند و هیچ‌کدام را نخواند.
 */

type TabKey = "ar-ap" | "profit" | "bank" | "checks" | "warehouse";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "ar-ap", label: "بدهکاران و بستانکاران" },
  { key: "profit", label: "سود کالا و دسته" },
  { key: "bank", label: "مغایرت بانکی" },
  { key: "checks", label: "چک‌های سررسید" },
  { key: "warehouse", label: "ارزش انبارها" },
];

interface WarehouseValuation {
  warehouses: Array<{
    id: string;
    name: string;
    code: string;
    type: string;
    isDefault: boolean;
    glCode: string | null;
    glName: string | null;
    qty: number;
    bookValue: number | null;
    inventoryValue: number;
    difference: number | null;
    needsAttention: boolean;
  }>;
  totals: {
    bookValue: number;
    inventoryValue: number;
    difference: number;
    needsAttention: number;
  };
}

interface PartyRow {
  id: string;
  party: string;
  mobile?: string | null;
  refType: string;
  refId: string;
  amount: number;
  paid: number;
  open: number;
  dueDate: string | null;
  bucket: string;
  daysLate: number;
  overdue: boolean;
}
interface ArApResult {
  asOf: string;
  receivables: { total: number; count: number; overdueTotal: number; byBucket: Record<string, number>; items: PartyRow[] };
  payables: { total: number; count: number; overdueTotal: number; byBucket: Record<string, number>; items: PartyRow[] };
  net: number;
}

interface ProfitRow {
  name: string;
  qty: number;
  revenue: number;
  cogs: number;
  profit: number | null;
  margin: number | null;
  costKnown: boolean;
}
interface ProfitResult {
  range: { from: string | null; to: string | null };
  totals: { qty: number; revenue: number; cogs: number; unknownCostCount: number };
  products: ProfitRow[];
  categories: Array<{ name: string; qty: number; revenue: number; cogs: number; profit: number; margin: number | null }>;
}

interface BankResult {
  accounts: Array<{
    id: string;
    name: string;
    bankName: string;
    accountNumber: string;
    glCode: string;
    glName: string;
    bookBalance: number;
    statementTotal: number;
    difference: number;
    statementCount: number;
    balanced: boolean;
  }>;
  reconciled: number;
  mismatched: number;
  totalDifference: number;
}

interface CheckItem {
  id: string;
  number: string;
  direction: string;
  bankName: string;
  amount: number;
  dueDate: string | null;
  status: string;
  payee: string | null;
  drawer: string | null;
  daysUntilDue: number | null;
}
interface ChecksResult {
  withinDays: number;
  overdue: { count: number; total: number; items: CheckItem[] };
  dueSoon: { count: number; total: number; items: CheckItem[] };
  later: { count: number; total: number; items: CheckItem[] };
}

const faDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("fa-IR") : "—";
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toLocaleString("fa-IR", { maximumFractionDigits: 0 })}٪`);
const money = (v: number) => fa(v.toLocaleString("fa-IR"));

export default function ReportsClient() {
  const { call, loading } = useAdminApi();
  const [tab, setTab] = useState<TabKey>("ar-ap");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [arAp, setArAp] = useState<ArApResult | null>(null);
  const [profit, setProfit] = useState<ProfitResult | null>(null);
  const [bank, setBank] = useState<BankResult | null>(null);
  const [checks, setChecks] = useState<ChecksResult | null>(null);
  const [warehouses, setWarehouses] = useState<WarehouseValuation | null>(null);

  // بازهٔ زمانی گزارش سود
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [withinDays, setWithinDays] = useState("30");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const q = `?${new URLSearchParams({ from, to }).toString()}`;
      const [a, b, c, d, e] = await Promise.all([
        call<ArApResult>(`/admin/accounting/reports/ar-ap`),
        call<ProfitResult>(`/admin/accounting/reports/product-profitability${q}`),
        call<BankResult>(`/admin/accounting/reports/bank-reconciliation`),
        call<ChecksResult>(`/admin/accounting/reports/checks-due?withinDays=${withinDays}`),
        call<WarehouseValuation>(`/admin/accounting/reports/warehouse-valuation${q}`),
      ]);
      if (a.ok && a.data) setArAp(a.data);
      else setError(a.error?.message ?? "خطا در گزارش بدهکاران");
      if (b.ok && b.data) setProfit(b.data);
      else setError(b.error?.message ?? "خطا در گزارش سود");
      if (c.ok && c.data) setBank(c.data);
      else setError(c.error?.message ?? "خطا در مغایرت بانکی");
      if (d.ok && d.data) setChecks(d.data);
      else setError(d.error?.message ?? "خطا در گزارش چک‌ها");
      if (e.ok && e.data) setWarehouses(e.data);
      else setError(e.error?.message ?? "خطا در ارزش‌گذاری انبار");
    } finally {
      setBusy(false);
    }
  }, [call, from, to, withinDays]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      {/* تب‌ها + بازه */}
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`h-9 rounded-full px-4 text-xs font-bold ${
              tab === t.key ? "bg-primary text-on-accent" : "border border-line text-ink/60"
            }`}
          >
            {t.label}
          </button>
        ))}

        <div className="ms-auto flex flex-wrap items-center gap-2">
          <label className="text-[11px] font-bold text-ink/60">
            از
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="ms-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
            />
          </label>
          <label className="text-[11px] font-bold text-ink/60">
            تا
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="ms-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
            />
          </label>
          <label className="text-[11px] font-bold text-ink/60">
            چک تا
            <input
              type="number"
              min={1}
              max={365}
              value={withinDays}
              onChange={(e) => setWithinDays(e.target.value)}
              className="ms-1 w-16 rounded-lg border border-line bg-surface px-2 py-1.5 text-[11px]"
            />
            روز
          </label>
          <button onClick={() => void load()} className="h-9 rounded-full border border-line px-3 text-[11px] font-bold">
            تازه‌سازی
          </button>
        </div>
      </div>

      {busy && <p className="text-xs text-ink/50">در حال محاسبه…</p>}
      {error && <p className="rounded-xl bg-app-err/10 px-4 py-2 text-xs font-bold text-app-err">{error}</p>}

      {/* ── بدهکاران و بستانکاران ── */}
      {tab === "ar-ap" && arAp && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="کل طلب ما" value={money(arAp.receivables.total)} tone="ok" />
            <Stat label="کل بدهی ما" value={money(arAp.payables.total)} tone="err" />
            <Stat label="خالص" value={money(arAp.net)} tone={arAp.net >= 0 ? "ok" : "err"} />
            <Stat label="سررسید گذشته" value={money(arAp.receivables.overdueTotal)} tone={arAp.receivables.overdueTotal > 0 ? "warn" : "ok"} />
          </div>

          <AgeBuckets title="سنی طلب ما" buckets={arAp.receivables.byBucket} />
          <AgeBuckets title="سنی بدهی ما" buckets={arAp.payables.byBucket} />

          <PartyTable title="بدهکاران" rows={arAp.receivables.items} />
          <PartyTable title="بستانکاران" rows={arAp.payables.items} />
        </div>
      )}

      {/* ── سود کالا ── */}
      {tab === "profit" && profit && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="فروش" value={money(profit.totals.revenue)} tone="ok" />
            <Stat label="بهای تمام‌شده" value={money(profit.totals.cogs)} tone="err" />
            <Stat label="سود ناخالص" value={money(profit.totals.revenue - profit.totals.cogs)} tone="ok" />
            <Stat
              label="کالای بدون بها"
              value={String(profit.totals.unknownCostCount)}
              tone={profit.totals.unknownCostCount > 0 ? "warn" : "ok"}
            />
          </div>

          {profit.totals.unknownCostCount > 0 && (
            <p className="rounded-xl bg-app-warning/10 px-4 py-3 text-[11px] leading-6 text-app-warning">
              سود {profit.totals.unknownCostCount} کالا **قابل اتکا نیست**: بهای خریدشان ثبت نشده، پس
              سودشان بیشتر از واقع نشان داده می‌شود. برای درست‌شدن، «بهای خرید» را در صفحهٔ محصول
              وارد کنید یا سند بهای تمام‌شده ثبت کنید.
            </p>
          )}

          <section className="rounded-card border border-line bg-surface">
            <h3 className="border-b border-line px-4 py-3 text-xs font-black">سود بر اساس دسته‌بندی</h3>
            <div className="admin-table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
                    <th className="px-3 py-2">دسته</th>
                    <th className="px-3 py-2 text-end">تعداد</th>
                    <th className="px-3 py-2 text-end">فروش</th>
                    <th className="px-3 py-2 text-end">بها</th>
                    <th className="px-3 py-2 text-end">سود</th>
                    <th className="px-3 py-2 text-end">حاشیه</th>
                  </tr>
                </thead>
                <tbody>
                  {profit.categories.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                        فروشی در این بازه نبوده.
                      </td>
                    </tr>
                  ) : (
                    profit.categories.map((c) => (
                      <tr key={c.name} className="border-b border-line/50">
                        <td className="px-3 py-2 font-bold">{c.name}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{fa(String(c.qty))}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{money(c.revenue)}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{money(c.cogs)}</td>
                        <td className="px-3 py-2 text-end tabular-nums font-bold">{money(c.profit)}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{pct(c.margin)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-card border border-line bg-surface">
            <h3 className="border-b border-line px-4 py-3 text-xs font-black">
              سود هر کالا{" "}
              <span className="font-normal text-ink/50">(بیشترین سود اول)</span>
            </h3>
            <div className="admin-table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
                    <th className="px-3 py-2">کالا</th>
                    <th className="px-3 py-2 text-end">تعداد</th>
                    <th className="px-3 py-2 text-end">فروش</th>
                    <th className="px-3 py-2 text-end">بها</th>
                    <th className="px-3 py-2 text-end">سود</th>
                    <th className="px-3 py-2 text-end">حاشیه</th>
                  </tr>
                </thead>
                <tbody>
                  {profit.products.map((p) => (
                    <tr key={p.name} className="border-b border-line/50">
                      <td className="px-3 py-2">{p.name}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{fa(String(p.qty))}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{money(p.revenue)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {p.costKnown ? money(p.cogs) : <span className="text-app-warning">نامشخص</span>}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums font-bold">
                        {p.costKnown ? money(p.profit ?? 0) : <span className="text-app-warning">قابل اتکا نیست</span>}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{pct(p.margin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ── مغایرت بانکی ── */}
      {tab === "bank" && bank && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <Stat label="حساب‌های مغایرت‌دار" value={`${bank.mismatched} از ${bank.accounts.length}`} tone={bank.mismatched > 0 ? "warn" : "ok"} />
            <Stat label="اختلاف کل" value={money(bank.totalDifference)} tone={bank.totalDifference === 0 ? "ok" : "warn"} />
            <Stat label="مغایرت‌گری‌شده" value={`${bank.reconciled}`} tone="ok" />
          </div>

          <section className="rounded-card border border-line bg-surface">
            <div className="admin-table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
                    <th className="px-3 py-2">حساب</th>
                    <th className="px-3 py-2">حساب دفتری</th>
                    <th className="px-3 py-2 text-end">ماندهٔ دفتر</th>
                    <th className="px-3 py-2 text-end">گردش پول‌خوان</th>
                    <th className="px-3 py-2 text-end">اختلاف</th>
                    <th className="px-3 py-2">وضعیت</th>
                  </tr>
                </thead>
                <tbody>
                  {bank.accounts.map((b) => (
                    <tr key={b.id} className="border-b border-line/50">
                      <td className="px-3 py-2">
                        <div className="font-bold">{b.name}</div>
                        <div className="text-[10px] text-ink/50">
                          {b.bankName} — <span dir="ltr">{b.accountNumber}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11px]" dir="ltr">
                        {b.glCode}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{money(b.bookBalance)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{money(b.statementTotal)}</td>
                      <td className="px-3 py-2 text-end tabular-nums font-bold">
                        {b.difference === 0 ? "۰" : money(b.difference)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            b.balanced ? "bg-app-ok/10 text-app-ok" : "bg-app-warning/10 text-app-warning"
                          }`}
                        >
                          {b.balanced ? "مغایرت ندارد" : "نیاز به بررسی"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* ── چک‌های سررسید ── */}
      {tab === "checks" && checks && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
            <Stat
              label={`سررسید گذشته (${checks.withinDays} روز قبل)`}
              value={`${fa(String(checks.overdue.count))} فقره`}
              tone={checks.overdue.count > 0 ? "err" : "ok"}
              sub={money(checks.overdue.total)}
            />
            <Stat
              label={`نزدیک سررسید (تا ${checks.withinDays} روز)`}
              value={`${fa(String(checks.dueSoon.count))} فقره`}
              tone={checks.dueSoon.count > 0 ? "warn" : "ok"}
              sub={money(checks.dueSoon.total)}
            />
            <Stat label="بعد از این بازه" value={`${fa(String(checks.later.count))} فقره`} tone="ok" sub={money(checks.later.total)} />
          </div>

          {checks.overdue.count > 0 && (
            <p className="rounded-xl bg-app-err/10 px-4 py-3 text-[11px] leading-6 text-app-err">
              {fa(String(checks.overdue.count))} چک از سررسید گذشته است. چک برگشتی یعنی یک چک
              وصول‌نشده و کسری نقدینگی — این‌ها را اول پیگیری کنید.
            </p>
          )}

          <CheckTable title="سررسید گذشته — نیازمند اقدام" rows={checks.overdue.items} tone="err" />
          <CheckTable title="نزدیک سررسید" rows={checks.dueSoon.items} tone="warn" />
        </div>
      )}

      {/* ── ارزش انبارها ── */}
      {tab === "warehouse" && warehouses && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="ارزش دفتری (GL)" value={money(warehouses.totals.bookValue)} tone="ok" />
            <Stat label="ارزش دفتر کالا" value={money(warehouses.totals.inventoryValue)} tone="ok" />
            <Stat
              label="اختلاف"
              value={money(warehouses.totals.difference)}
              tone={Math.abs(warehouses.totals.difference) > 1 ? "err" : "ok"}
            />
            <Stat
              label="انبار نیازمند بررسی"
              value={String(warehouses.totals.needsAttention)}
              tone={warehouses.totals.needsAttention > 0 ? "warn" : "ok"}
            />
          </div>

          {warehouses.totals.needsAttention > 0 && (
            <p className="rounded-xl bg-app-warning/10 px-4 py-3 text-[11px] leading-6 text-app-warning">
              ارزش دفتری و ارزش دفتر کالا برای {fa(String(warehouses.totals.needsAttention))} انبار نمی‌خوانند.
              معمولاً یکی از این دو علت است: انبار هنوز حساب دفتری اختصاصی ندارد، یا بهای تمام‌شدهٔ
              آن انبار کامل ثبت نشده. تا وقتی این دو یکی نشوند، ارزش موجودی در ترازنامه قابل
              اتکا نیست.
            </p>
          )}

          <section className="rounded-card border border-line bg-surface">
            <h3 className="border-b border-line px-4 py-3 text-xs font-black">
              مقایسهٔ دفتر مالی با دفتر کالا
            </h3>
            <div className="admin-table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
                    <th className="px-3 py-2">انبار</th>
                    <th className="px-3 py-2">حساب دفتری</th>
                    <th className="px-3 py-2 text-end">تعداد کالا</th>
                    <th className="px-3 py-2 text-end">ارزش دفتری</th>
                    <th className="px-3 py-2 text-end">ارزش دفتر کالا</th>
                    <th className="px-3 py-2 text-end">اختلاف</th>
                  </tr>
                </thead>
                <tbody>
                  {warehouses.warehouses.map((w) => (
                    <tr key={w.id} className="border-b border-line/50">
                      <td className="px-3 py-2">
                        <div className="font-bold">
                          {w.name}
                          {w.isDefault ? <span className="text-[10px] text-app-warning"> ★ پیش‌فرض</span> : null}
                        </div>
                        <div className="text-[10px] text-ink/50" dir="ltr">
                          {w.code}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[11px]" dir="ltr">
                        {w.glCode ?? <span className="text-app-warning">اختصاصی ندارد</span>}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{fa(String(w.qty))}</td>
                      <td className="px-3 py-2 text-end tabular-nums">
                        {w.bookValue == null ? "—" : money(w.bookValue)}
                      </td>
                      <td className="px-3 py-2 text-end tabular-nums">{money(w.inventoryValue)}</td>
                      <td
                        className={`px-3 py-2 text-end tabular-nums font-bold ${
                          w.difference == null ? "" : Math.abs(w.difference) > 1 ? "text-app-err" : "text-app-ok"
                        }`}
                      >
                        {w.difference == null ? "—" : money(w.difference)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "ok" | "err" | "warn";
}) {
  const cls = {
    ok: "border-app-ok/30 text-app-ok",
    err: "border-app-err/30 text-app-err",
    warn: "border-app-warning/40 text-app-warning",
  }[tone];
  return (
    <div className={`rounded-card border bg-surface p-3 ${cls}`}>
      <p className="text-[11px] font-bold opacity-80">{label}</p>
      <p className="mt-1 text-base font-black tabular-nums">{value}</p>
      {sub && <p className="text-[10px] opacity-70 tabular-nums">{sub}</p>}
    </div>
  );
}

function AgeBuckets({ title, buckets }: { title: string; buckets: Record<string, number> }) {
  const entries = Object.entries(buckets);
  if (entries.length === 0) return null;
  return (
    <section className="rounded-card border border-line bg-surface p-3">
      <h3 className="mb-2 text-xs font-black">{title} — تفکیک سنی</h3>
      <div className="space-y-1.5">
        {entries.map(([k, v]) => {
          const max = Math.max(...entries.map(([, x]) => x), 1);
          const late = k.includes("گذشته") && !k.includes("بدون");
          return (
            <div key={k} className="flex items-center gap-2">
              <span className="w-32 shrink-0 text-[11px] font-bold">{k}</span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-ink/[0.06]">
                <div
                  className={`h-full rounded-full ${late ? "bg-app-err/70" : "bg-app-primary/70"}`}
                  style={{ width: `${Math.max(4, (v / max) * 100)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-end text-[11px] font-bold tabular-nums">{money(v)}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function PartyTable({ title, rows }: { title: string; rows: PartyRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="rounded-card border border-line bg-surface">
      <h3 className="border-b border-line px-4 py-3 text-xs font-black">
        {title} <span className="font-normal text-ink/50">({fa(String(rows.length))} مورد)</span>
      </h3>
      <div className="admin-table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
              <th className="px-3 py-2">طرف حساب</th>
              <th className="px-3 py-2">مرجع</th>
              <th className="px-3 py-2">سررسید</th>
              <th className="px-3 py-2">وضعیت</th>
              <th className="px-3 py-2 text-end">کل</th>
              <th className="px-3 py-2 text-end">پرداخت‌شده</th>
              <th className="px-3 py-2 text-end">مانده</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/50">
                <td className="px-3 py-2">
                  <div className="font-bold">{r.party}</div>
                  {r.mobile && <div className="text-[10px] text-ink/50" dir="ltr">{r.mobile}</div>}
                </td>
                <td className="px-3 py-2 text-[10px] text-ink/60" dir="ltr">{r.refType}</td>
                <td className="px-3 py-2 text-[11px]">{faDate(r.dueDate)}</td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      r.overdue ? "bg-app-err/10 text-app-err" : "bg-app-ok/10 text-app-ok"
                    }`}
                  >
                    {r.bucket}
                    {r.daysLate > 0 && ` · ${fa(String(r.daysLate))} روز`}
                  </span>
                </td>
                <td className="px-3 py-2 text-end tabular-nums">{money(r.amount)}</td>
                <td className="px-3 py-2 text-end tabular-nums">{money(r.paid)}</td>
                <td className="px-3 py-2 text-end tabular-nums font-bold">{money(r.open)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CheckTable({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: CheckItem[];
  tone: "err" | "warn";
}) {
  if (rows.length === 0) return null;
  const cls = tone === "err" ? "border-app-err/40" : "border-app-warning/40";
  return (
    <section className={`rounded-card border bg-surface ${cls}`}>
      <h3 className="border-b border-line px-4 py-3 text-xs font-black">
        {title} <span className="font-normal text-ink/50">({fa(String(rows.length))} فقره)</span>
      </h3>
      <div className="admin-table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-ink/[0.03] text-right text-[11px] text-ink/60">
              <th className="px-3 py-2">شمارهٔ چک</th>
              <th className="px-3 py-2">نوع</th>
              <th className="px-3 py-2">مشخص</th>
              <th className="px-3 py-2">سررسید</th>
              <th className="px-3 py-2 text-end">مبلغ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line/50">
                <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{c.number}</td>
                <td className="px-3 py-2 text-[11px]">
                  {c.direction === "RECEIVED" ? "دریافتی" : "پرداختی"}
                </td>
                <td className="px-3 py-2 text-[11px]">
                  <div>{c.payee ?? c.drawer ?? "—"}</div>
                  <div className="text-[10px] text-ink/50">{c.bankName}</div>
                </td>
                <td className="px-3 py-2 text-[11px]">
                  {faDate(c.dueDate)}
                  {c.daysUntilDue != null && (
                    <span className={`ms-1 text-[10px] font-bold ${c.daysUntilDue < 0 ? "text-app-err" : "text-app-warning"}`}>
                      {c.daysUntilDue < 0
                        ? `${fa(String(-c.daysUntilDue))} روز گذشته`
                        : `${fa(String(c.daysUntilDue))} روز مانده`}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-end tabular-nums font-bold">{money(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}