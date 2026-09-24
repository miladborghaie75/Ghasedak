"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface TBRow { code: string; name: string; debit: string; credit: string; }
interface Integrity { balanced: boolean; debit: string; credit: string; }
interface PnL { revenue: string; cogs: string; grossProfit: string; expenses: string; netProfit: string; grossMargin: number | null; netMargin: number | null; }
interface Monthly { month: number; revenue: string; expense: string; }
interface EntryRow { id: string; number: string; date: string; description: string | null; lines: Array<{ account: { code: string; name: string }; debit: string; credit: string }>; }
interface SaleRow { number: string; total: string; party: string; channel: string; kind: string; createdAt: string; }
interface AccountRow { code: string; name: string; type: string; }

const TABS = [
  { key: "balance", label: "تراز آزمایشی" },
  { key: "pnl", label: "سود و زیان" },
  { key: "entries", label: "اسناد" },
  { key: "sales", label: "فاکتور فروش" },
  { key: "purchases", label: "فاکتور خرید" },
  { key: "payroll", label: "حقوق و دستمزد" },
  { key: "accounts", label: "دفتر چارت" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const MONTHS_FA = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];

export default function AccountingClient() {
  const { call, loading } = useAdminApi();
  const [tab, setTab] = useState<TabKey>("balance");
  const [tb, setTb] = useState<TBRow[]>([]);
  const [integrity, setIntegrity] = useState<Integrity | null>(null);
  const [pnl, setPnl] = useState<PnL | null>(null);
  const [monthly, setMonthly] = useState<Monthly[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [sales, setSales] = useState<SaleRow[]>([]);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [payroll, setPayroll] = useState({ employeeName: "", title: "حقوق مرداد", amount: "" });

  useEffect(() => {
    void (async () => {
      const [tbR, intR] = await Promise.all([
        call<{ items?: TBRow[] } | TBRow[]>("/admin/accounting/trial-balance"),
        call<Integrity>("/admin/accounting/integrity"),
      ]);
      if (tbR.ok && tbR.data) setTb(Array.isArray(tbR.data) ? tbR.data : (tbR.data.items ?? []));
      if (intR.ok && intR.data) setIntegrity(intR.data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTab = async (t: TabKey) => {
    setError(null);
    if (t === "pnl") {
      const [p, m] = await Promise.all([
        call<PnL>("/admin/accounting/pnl"),
        call<Monthly[]>("/admin/accounting/monthly"),
      ]);
      if (p.ok && p.data) setPnl(p.data); else setError(p.error?.message ?? "خطا");
      if (m.ok && m.data) setMonthly(m.data);
    } else if (t === "entries") {
      const r = await call<{ items: EntryRow[] }>("/admin/accounting/entries");
      if (r.ok && r.data) setEntries(r.data.items); else setError(r.error?.message ?? "خطا");
    } else if (t === "sales") {
      const r = await call<{ items: SaleRow[] }>("/admin/accounting/sales-invoices");
      if (r.ok && r.data) setSales(r.data.items); else setError(r.error?.message ?? "خطا");
    } else if (t === "accounts") {
      const r = await call<{ items: AccountRow[] }>("/admin/accounting/accounts");
      if (r.ok && r.data) setAccounts(r.data.items); else setError(r.error?.message ?? "خطا");
    } else if (t === "purchases") {
      const r = await call<{ items: unknown[] }>("/admin/accounting/purchase-invoices");
      if (!r.ok) setError(r.error?.message ?? "خطا");
    }
  };

  const switchTab = (t: TabKey) => { setTab(t); void loadTab(t); };

  const submitPayroll = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setMsg(null);
    const r = await call("/admin/accounting/payroll", {
      method: "POST",
      body: JSON.stringify({ employeeName: payroll.employeeName, title: payroll.title, amount: Number(payroll.amount) }),
    });
    if (r.ok) { setMsg("سند حقوق ثبت شد ✅"); setPayroll({ employeeName: "", title: "حقوق ماهانه", amount: "" }); }
    else setError(r.error?.message ?? "خطا");
  };

  const reverse = async (id: string) => {
    if (!confirm("ثبت سند معکوس برای اصلاح؟")) return;
    const r = await call(`/admin/accounting/entries/${id}/reverse`, { method: "POST" });
    if (r.ok) { setMsg("سند معکوس ثبت شد."); void loadTab("entries"); } else setError(r.error?.message ?? "خطا");
  };

  // نمودار ستونی ساده بدون کتابخانه
  const maxVal = Math.max(1, ...monthly.map((m) => Number(m.revenue)), ...monthly.map((m) => Number(m.expense)));

  return (
    <div className="flex flex-col gap-5">
      {integrity ? (
        <div className={`rounded-card border p-4 text-sm font-bold ${integrity.balanced ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-700"}`}>
          {integrity.balanced ? `توازن اسناد برقرار است ✅ — بدهکار ${fa(integrity.debit)} = بستانکار ${fa(integrity.credit)}` : "⚠️ عدم توازن!"}
        </div>
      ) : null}
      {msg ? <p className="rounded-xl bg-green-50 px-4 py-2 text-xs font-bold text-green-800">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-600">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`h-9 rounded-full px-4 text-xs font-black ${tab === t.key ? "bg-primary text-white" : "border border-line bg-white text-ink/70"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <p className="text-xs text-ink/50">در حال بارگذاری…</p> : null}

      {tab === "balance" ? (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">کد</th><th className="px-4 py-3">حساب</th><th className="px-4 py-3">بدهکار</th><th className="px-4 py-3">بستانکار</th>
            </tr></thead>
            <tbody>
              {tb.map((r) => (
                <tr key={r.code} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3" dir="ltr">{r.code}</td>
                  <td className="px-4 py-3 font-bold">{r.name}</td>
                  <td className="px-4 py-3 tabular-nums">{Number(r.debit) ? fa(r.debit) : "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{Number(r.credit) ? fa(r.credit) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "pnl" ? (
        <div className="flex flex-col gap-5">
          {pnl ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-card border border-line bg-surface p-4"><p className="text-xs text-ink/60">درآمد (فروش)</p><p className="mt-1 text-lg font-black tabular-nums text-ink">{fa(pnl.revenue)}</p></div>
              <div className="rounded-card border border-line bg-surface p-4"><p className="text-xs text-ink/60">سود ناخالص</p><p className="mt-1 text-lg font-black tabular-nums text-green-700">{fa(pnl.grossProfit)}</p><p className="text-[10px] text-ink/50">حاشیه: {pnl.grossMargin ?? "—"}٪</p></div>
              <div className="rounded-card border border-line bg-surface p-4"><p className="text-xs text-ink/60">هزینه‌ها</p><p className="mt-1 text-lg font-black tabular-nums text-amber-600">{fa(pnl.expenses)}</p></div>
              <div className="rounded-card border border-line bg-surface p-4"><p className="text-xs text-ink/60">سود خالص</p><p className={`mt-1 text-lg font-black tabular-nums ${Number(pnl.netProfit) >= 0 ? "text-green-700" : "text-red-600"}`}>{fa(pnl.netProfit)}</p><p className="text-[10px] text-ink/50">حاشیه: {pnl.netMargin ?? "—"}٪</p></div>
            </div>
          ) : null}
          {/* نمودار درآمد/هزینه ماهانه */}
          <div className="rounded-card border border-line bg-surface p-5">
            <h3 className="text-sm font-black text-ink">روند ماهانه (درآمد/هزینه)</h3>
            <div className="mt-4 flex h-40 items-end gap-2" dir="ltr">
              {monthly.map((m) => (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex h-32 w-full items-end justify-center gap-0.5">
                    <div className="w-1/2 rounded-t bg-primary" style={{ height: `${(Number(m.revenue) / maxVal) * 100}%` }} title={`درآمد: ${fa(m.revenue)}`} />
                    <div className="w-1/2 rounded-t bg-amber-400" style={{ height: `${(Number(m.expense) / maxVal) * 100}%` }} title={`هزینه: ${fa(m.expense)}`} />
                  </div>
                  <span className="text-[9px] text-ink/50">{MONTHS_FA[m.month - 1]?.slice(0, 4)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-[10px] text-ink/60">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-primary" /> درآمد</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-amber-400" /> هزینه</span>
            </div>
          </div>
        </div>
      ) : null}

      {tab === "entries" ? (
        <div className="flex flex-col gap-3">
          {entries.length === 0 ? <p className="rounded-card border border-line bg-surface px-4 py-8 text-center text-sm text-ink/50">سندی ثبت نشده است.</p> : null}
          {entries.map((e) => (
            <div key={e.id} className="rounded-card border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm font-black" dir="ltr">{e.number}</span>
                  <span className="ms-2 text-xs text-ink/50">{new Date(e.date).toLocaleDateString("fa-IR")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-ink/70">{e.description ?? "—"}</span>
                  <button onClick={() => reverse(e.id)} className="rounded-full border border-line px-3 py-1 text-[10px] font-bold text-ink/60">سند معکوس</button>
                </div>
              </div>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-1" dir="ltr">{l.account.code} — {l.account.name}</td>
                      <td className="py-1 text-left tabular-nums">{Number(l.debit) ? fa(l.debit) : ""}</td>
                      <td className="py-1 text-left tabular-nums">{Number(l.credit) ? fa(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : null}

      {tab === "sales" ? (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">شماره</th><th className="px-4 py-3">نوع</th><th className="px-4 py-3">طرف حساب</th><th className="px-4 py-3">کانال</th><th className="px-4 py-3">مبلغ</th><th className="px-4 py-3">تاریخ</th>
            </tr></thead>
            <tbody>
              {sales.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/50">فاکتوری نیست.</td></tr> : sales.map((s) => (
                <tr key={`${s.kind}-${s.number}`} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3 font-bold" dir="ltr">{s.number}</td>
                  <td className="px-4 py-3 text-xs">{s.kind === "POS" ? "صندوق" : "آنلاین"}</td>
                  <td className="px-4 py-3">{s.party}</td>
                  <td className="px-4 py-3 text-ink/60">{s.channel}</td>
                  <td className="px-4 py-3 tabular-nums">{fa(s.total)}</td>
                  <td className="px-4 py-3 text-xs text-ink/60">{new Date(s.createdAt).toLocaleDateString("fa-IR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {tab === "purchases" ? (
        <p className="rounded-card border border-dashed border-line bg-surface px-4 py-10 text-center text-sm text-ink/50">
          ماژول خرید هنوز فعال نشده — پس از ثبت اولین فاکتور خرید، اینجا نمایش داده می‌شود.
        </p>
      ) : null}

      {tab === "payroll" ? (
        <form onSubmit={submitPayroll} className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">ثبت حقوق و دستمزد</h3>
          <p className="mt-1 text-xs text-ink/50">سند اتوماتیک: Dr هزینه عملیاتی / Cr حساب‌های پرداختنی.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold text-ink/70">نام کارمند<input value={payroll.employeeName} onChange={(e) => setPayroll({ ...payroll, employeeName: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">عنوان<input value={payroll.title} onChange={(e) => setPayroll({ ...payroll, title: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">مبلغ (تومان)<input type="number" value={payroll.amount} onChange={(e) => setPayroll({ ...payroll, amount: e.target.value })} required min={1} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
          </div>
          <button type="submit" className="mt-4 h-10 rounded-full bg-primary px-6 text-sm font-black text-white">ثبت سند حقوق</button>
        </form>
      ) : null}

      {tab === "accounts" ? (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">کد</th><th className="px-4 py-3">نام حساب</th><th className="px-4 py-3">نوع</th>
            </tr></thead>
            <tbody>
              {accounts.map((a) => (
                <tr key={a.code} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3" dir="ltr">{a.code}</td>
                  <td className="px-4 py-3 font-bold">{a.name}</td>
                  <td className="px-4 py-3 text-xs text-ink/60" dir="ltr">{a.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
