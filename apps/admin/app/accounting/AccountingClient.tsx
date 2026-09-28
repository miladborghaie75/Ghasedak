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
/** فاز ۱۰ — بخش ۱۴: نود درخت حساب‌ها (توازن تجمعی از Ledger) */
interface TreeAccount {
  id: string; code: string; name: string; type: string; level: number; isActive: boolean;
  balanceDr: string; balanceCr: string;
  children: TreeAccount[];
}
interface AccountLedgerLine { entryId: string; entryNumber: string; entryState: string; date: string; description: string | null; debit: string; credit: string; }
/** فاز ۱۰ — بخش ۱۳: سند دستی — خطوط داینامیک با اعتبارسنجی سمت کلاینت (نهایی سمت سرور) */
interface ManualLine { accountCode: string; debit: string; credit: string; }
/** درس ریسک ۶ — شکست ثبت سند از postOrNotify (Notification journal-fail:*) */
interface PostFailure { id: string; key: string; code: string; message: string; sourceType: string | null; sourceId: string | null; description: string | null; lines: Array<{ accountCode?: string; debit?: number; credit?: number }>; at: string; }

const TABS = [
  { key: "balance", label: "تراز آزمایشی" },
  { key: "pnl", label: "سود و زیان" },
  { key: "entries", label: "اسناد" },
  { key: "manual", label: "سند دستی" },
  { key: "tree", label: "درخت حساب‌ها" },
  { key: "sales", label: "فاکتور فروش" },
  { key: "purchases", label: "فاکتور خرید" },
  { key: "payroll", label: "حقوق و دستمزد" },
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
  const [tree, setTree] = useState<TreeAccount[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [ledger, setLedger] = useState<{ account: { code: string; name: string; isActive: boolean }; items: AccountLedgerLine[] } | null>(null);
  const [childForm, setChildForm] = useState<{ parentId: string | null; code: string; name: string }>({ parentId: null, code: "", name: "" });
  const [manual, setManual] = useState<{ date: string; description: string; state: "DRAFT" | "FINAL"; lines: ManualLine[] }>({
    date: new Date().toISOString().slice(0, 10),
    description: "",
    state: "FINAL",
    lines: [
      { accountCode: "", debit: "", credit: "" },
      { accountCode: "", debit: "", credit: "" },
    ],
  });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [payroll, setPayroll] = useState({ employeeName: "", title: "حقوق مرداد", amount: "" });
  const [postFailures, setPostFailures] = useState<PostFailure[]>([]);
  const [failureCount, setFailureCount] = useState(0);
  const [showFailures, setShowFailures] = useState(false);

  useEffect(() => {
    void (async () => {
      const [tbR, intR, failR] = await Promise.all([
        call<{ items?: TBRow[] } | TBRow[]>("/admin/accounting/trial-balance"),
        call<Integrity>("/admin/accounting/integrity"),
        call<{ items: PostFailure[]; failureCount7d: number }>("/admin/accounting/post-failures"),
      ]);
      if (tbR.ok && tbR.data) setTb(Array.isArray(tbR.data) ? tbR.data : (tbR.data.items ?? []));
      if (intR.ok && intR.data) setIntegrity(intR.data);
      if (failR.ok && failR.data) { setPostFailures(failR.data.items); setFailureCount(failR.data.failureCount7d); }
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
    } else if (t === "manual") {
      const r = await call<{ items: AccountRow[] }>("/admin/accounting/accounts");
      if (r.ok && r.data) setAccounts(r.data.items.filter((a) => Number(a.code.match(/^\d+/)?.[0] ?? 99) >= 1000)); else setError(r.error?.message ?? "خطا");
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

  /** فاز ۱۰ — بخش ۱۳: ثبت سند دستی DRAFT/FINAL */
  const manualTotals = () => {
    const dr = manual.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const cr = manual.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { dr, cr, balanced: dr > 0 && dr === cr };
  };
  const submitManual = async () => {
    setError(null); setMsg(null);
    const lines = manual.lines
      .map((l) => ({ accountCode: l.accountCode, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 }))
      .filter((l) => l.accountCode);
    if (lines.length < 2) { setError("حداقل ۲ خط الزامی است."); return; }
    if (lines.some((l) => l.debit > 0 && l.credit > 0)) { setError("یک خط نمی‌تواند هم بدهکار و هم بستانکار باشد."); return; }
    if (lines.some((l) => l.debit <= 0 && l.credit <= 0)) { setError("هر خط باید بدهکار یا بستانکار مثبت داشته باشد."); return; }
    const { balanced } = manualTotals();
    if (!balanced) { setError("جمع بدهکار باید برابر جمع بستانکار باشد."); return; }
    const r = await call("/admin/accounting/journal/manual", {
      method: "POST",
      body: JSON.stringify({
        date: new Date(manual.date),
        description: manual.description || "سند دستی",
        sourceType: "manual",
        state: manual.state,
        lines: lines.map((l) => ({ accountCode: l.accountCode, debit: l.debit || undefined, credit: l.credit || undefined })),
      }),
    });
    if (r.ok) {
      setMsg(manual.state === "FINAL" ? "سند نهایی ثبت شد ✅" : "پیش‌نویس ذخیره شد — از تب «اسناد» نهایی‌سازی کنید.");
      setManual((m) => ({ ...m, description: "", lines: [{ accountCode: "", debit: "", credit: "" }, { accountCode: "", debit: "", credit: "" }] }));
    } else setError(r.error?.message ?? "خطا");
  };
  const finalizeEntry = async (id: string) => {
    const r = await call(`/admin/accounting/journal/${id}/finalize`, { method: "POST" });
    if (r.ok) { setMsg("سند نهایی شد."); void loadTab("entries"); } else setError(r.error?.message ?? "خطا");
  };
  const openLedger = async (node: TreeAccount) => {
    const r = await call<{ account: { code: string; name: string; isActive: boolean }; items: AccountLedgerLine[] }>(`/admin/accounting/accounts/${node.id}/ledger`);
    if (r.ok && r.data) setLedger(r.data); else setError(r.error?.message ?? "خطا");
  };
  const createChild = async () => {
    if (!childForm.parentId || !childForm.code || !childForm.name) return;
    const r = await call(`/admin/accounting/accounts/${childForm.parentId}/children`, {
      method: "POST",
      body: JSON.stringify({ code: childForm.code, name: childForm.name }),
    });
    if (r.ok) {
      setMsg("حساب فرزند ایجاد شد.");
      setChildForm({ parentId: null, code: "", name: "" });
      const t = await call<{ items: TreeAccount[] }>("/admin/accounting/accounts/tree");
      if (t.ok && t.data) setTree(t.data.items);
    } else setError(r.error?.message ?? "خطا");
  };
  const toggleActive = async (node: TreeAccount) => {
    const r = await call(`/admin/accounting/accounts/${node.id}/active`, { method: "POST", body: JSON.stringify({ isActive: !node.isActive }) });
    if (r.ok) {
      const t = await call<{ items: TreeAccount[] }>("/admin/accounting/accounts/tree");
      if (t.ok && t.data) setTree(t.data.items);
    } else setError(r.error?.message ?? "خطا");
  };
  const toggleNode = (id: string) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const renderNode = (node: TreeAccount, depth: number): React.ReactNode => (
    <>
      <tr className="border-b border-line/60 last:border-0">
        <td className="px-4 py-2" dir="ltr">
          <span style={{ paddingInlineStart: depth * 18 }} className="inline-flex items-center gap-1">
            {node.children.length > 0 ? (
              <button onClick={() => toggleNode(node.id)} className="text-ink/40 hover:text-ink">{expanded.has(node.id) ? "▾" : "▸"}</button>
            ) : <span className="inline-block w-3" />}
            <span className="font-mono text-xs">{node.code}</span>
          </span>
        </td>
        <td className={`px-4 py-2 ${node.isActive ? "font-bold" : "text-ink/40 line-through"}`}>
          {node.name}
          {node.children.length > 0 ? <span className="ms-1 text-[10px] text-ink/40">({node.children.length})</span> : null}
        </td>
        <td className="px-4 py-2 text-[10px] text-ink/50" dir="ltr">{node.type}</td>
        <td className="px-4 py-2 tabular-nums">{Number(node.balanceDr) ? fa(node.balanceDr) : "—"}</td>
        <td className="px-4 py-2 tabular-nums">{Number(node.balanceCr) ? fa(node.balanceCr) : "—"}</td>
        <td className="px-4 py-2">
          <div className="flex gap-1">
            <button onClick={() => void openLedger(node)} className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold text-ink/60">دفتر</button>
            <button onClick={() => setChildForm({ parentId: node.id, code: "", name: "" })} className="rounded-full border border-line px-2 py-0.5 text-[10px] font-bold text-ink/60">+ فرزند</button>
            <button onClick={() => void toggleActive(node)} className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${node.isActive ? "border border-line text-ink/60" : "bg-app-ok/10 text-app-ok"}`}>{node.isActive ? "غیرفعال" : "فعال‌سازی"}</button>
          </div>
        </td>
      </tr>
      {expanded.has(node.id) ? node.children.map((c) => renderNode(c, depth + 1)) : null}
    </>
  );

  // نمودار ستونی ساده بدون کتابخانه
  const maxVal = Math.max(1, ...monthly.map((m) => Number(m.revenue)), ...monthly.map((m) => Number(m.expense)));

  return (
    <div className="flex flex-col gap-5">
      {/* درس ریسک ۶ — شکست‌های posting هرگز بی‌صدا نمی‌مانند؛ بنر هشدار تا رفع باقی است */}
      {failureCount > 0 ? (
        <div className="rounded-card border border-app-err bg-app-primary-soft p-4">
          <button onClick={() => setShowFailures((s) => !s)} className="flex w-full items-center justify-between text-start">
            <span className="text-sm font-black text-app-err">
              ⚠️ {fa(failureCount)} شکست ثبت سند حسابداری در ۷ روز اخیر — اسناد ثانویه ثبت نشده‌اند (عملیات اصلی سالم است)
            </span>
            <span className="text-xs font-bold text-app-err">{showFailures ? "بستن ▲" : "مشاهده جزئیات ▼"}</span>
          </button>
          {showFailures ? (
            <ul className="mt-3 flex flex-col gap-2">
              {postFailures.map((f) => (
                <li key={f.id} className="rounded-xl border border-app-err/40 bg-surface p-3 text-xs">
                  <p className="font-black text-app-err" dir="ltr">{f.code}</p>
                  <p className="mt-0.5 text-ink">{f.message}</p>
                  <p className="mt-0.5 text-muted">
                    منبع: <span dir="ltr">{f.sourceType ?? "—"}{f.sourceId ? ` · ${f.sourceId.slice(0, 12)}` : ""}</span>
                    {f.description ? ` · ${f.description}` : ""} · {new Date(f.at).toLocaleString("fa-IR")}
                  </p>
                  {f.lines.length > 0 ? (
                    <p className="mt-0.5 text-muted" dir="ltr">
                      {f.lines.map((l) => `${l.accountCode ?? "?"}:${(l.debit ?? 0) > 0 ? `Dr${l.debit}` : `Cr${l.credit}`}`).join(" | ")}
                    </p>
                  ) : null}
                </li>
              ))}
              {postFailures.length === 0 ? <li className="text-xs text-muted">جزئیاتی در ۷ روز اخیر نیست.</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}

      {integrity ? (
        <div className={`rounded-card border p-4 text-sm font-bold ${integrity.balanced ? "border-app-ok bg-app-primary-soft text-app-ok" : "border-app-err bg-app-primary-soft text-app-err"}`}>
          {integrity.balanced ? `توازن اسناد برقرار است ✅ — بدهکار ${fa(integrity.debit)} = بستانکار ${fa(integrity.credit)}` : "⚠️ عدم توازن!"}
        </div>
      ) : null}
      {msg ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => switchTab(t.key)}
            className={`h-9 rounded-full px-4 text-xs font-black ${tab === t.key ? "bg-primary text-on-accent" : "border border-line bg-surface text-ink/70"}`}>
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
              <div className="rounded-card border border-line bg-surface p-4"><p className="text-xs text-ink/60">سود ناخالص</p><p className="mt-1 text-lg font-black tabular-nums text-app-ok">{fa(pnl.grossProfit)}</p><p className="text-[10px] text-ink/50">حاشیه: {pnl.grossMargin ?? "—"}٪</p></div>
              <div className="rounded-card border border-line bg-surface p-4"><p className="text-xs text-ink/60">هزینه‌ها</p><p className="mt-1 text-lg font-black tabular-nums text-app-warning">{fa(pnl.expenses)}</p></div>
              <div className="rounded-card border border-line bg-surface p-4"><p className="text-xs text-ink/60">سود خالص</p><p className={`mt-1 text-lg font-black tabular-nums ${Number(pnl.netProfit) >= 0 ? "text-app-ok" : "text-app-err"}`}>{fa(pnl.netProfit)}</p><p className="text-[10px] text-ink/50">حاشیه: {pnl.netMargin ?? "—"}٪</p></div>
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
                    <div className="w-1/2 rounded-t bg-app-warning" style={{ height: `${(Number(m.expense) / maxVal) * 100}%` }} title={`هزینه: ${fa(m.expense)}`} />
                  </div>
                  <span className="text-[9px] text-ink/50">{MONTHS_FA[m.month - 1]?.slice(0, 4)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-4 text-[10px] text-ink/60">
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-primary" /> درآمد</span>
              <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded bg-app-warning" /> هزینه</span>
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
                  {(e as unknown as { state?: string }).state === "DRAFT" ? (
                    <button onClick={() => void finalizeEntry(e.id)} className="rounded-full bg-app-ok/10 px-3 py-1 text-[10px] font-black text-app-ok">نهایی‌سازی</button>
                  ) : null}
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

      {/* فاز ۱۰ — بخش ۱۳: سند دستی با خطوط داینامیک و اعتبارسنجی زنده */}
      {tab === "manual" ? (
        <div className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">ثبت سند دستی</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold text-ink/70">تاریخ
              <input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
            </label>
            <label className="text-xs font-bold text-ink/70 sm:col-span-2">شرح
              <input value={manual.description} onChange={(e) => setManual({ ...manual, description: e.target.value })} placeholder="مثال: اصلاحیه هزینه حمل" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_120px_120px_40px] gap-2 text-[10px] font-bold text-ink/50">
              <span>حساب</span><span>بدهکار</span><span>بستانکار</span><span />
            </div>
            {manual.lines.map((l, i) => (
              <div key={i} className="grid grid-cols-[1fr_120px_120px_40px] items-center gap-2">
                <select value={l.accountCode} onChange={(e) => setManual((m) => { const lines = [...m.lines]; lines[i] = { ...lines[i], accountCode: e.target.value }; return { ...m, lines }; })} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                  <option value="">— انتخاب حساب —</option>
                  {accounts.map((a) => <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                </select>
                <input inputMode="numeric" value={l.debit} onChange={(e) => setManual((m) => { const lines = [...m.lines]; lines[i] = { ...lines[i], debit: e.target.value.replace(/[^\d]/g, ""), credit: "" }; return { ...m, lines }; })} placeholder="۰" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm tabular-nums" disabled={Boolean(l.credit)} />
                <input inputMode="numeric" value={l.credit} onChange={(e) => setManual((m) => { const lines = [...m.lines]; lines[i] = { ...lines[i], credit: e.target.value.replace(/[^\d]/g, ""), debit: "" }; return { ...m, lines }; })} placeholder="۰" className="rounded-xl border border-line bg-surface px-3 py-2 text-sm tabular-nums" disabled={Boolean(l.debit)} />
                <button onClick={() => setManual((m) => ({ ...m, lines: m.lines.filter((_, j) => j !== i) }))} disabled={manual.lines.length <= 2} className="text-app-err disabled:opacity-30" title="حذف خط">✕</button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button onClick={() => setManual((m) => ({ ...m, lines: [...m.lines, { accountCode: "", debit: "", credit: "" }] }))} className="rounded-full border border-line px-4 py-1.5 text-xs font-bold text-ink/70">+ افزودن خط</button>
            <div className={`text-xs font-black tabular-nums ${manualTotals().balanced ? "text-app-ok" : "text-ink/50"}`}>
              بدهکار {fa(manualTotals().dr)} / بستانکار {fa(manualTotals().cr)} {manualTotals().balanced ? "✅ متعادل" : "⚠️ نا‌متعادل"}
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs font-bold text-ink/70">
              <input type="radio" checked={manual.state === "FINAL"} onChange={() => setManual({ ...manual, state: "FINAL" })} /> نهایی (قابل audit)
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-ink/70">
              <input type="radio" checked={manual.state === "DRAFT"} onChange={() => setManual({ ...manual, state: "DRAFT" })} /> پیش‌نویس
            </label>
            <button onClick={() => void submitManual()} disabled={loading} className="ms-auto h-10 rounded-full bg-primary px-6 text-sm font-black text-on-accent disabled:opacity-50">ثبت سند</button>
          </div>
        </div>
      ) : null}

      {/* فاز ۱۰ — بخش ۱۴: درخت حساب‌ها از parentAccountId موجود */}
      {tab === "tree" ? (
        <div className="flex flex-col gap-3">
          {childForm.parentId ? (
            <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-4">
              <span className="text-xs font-black text-ink">ایجاد حساب فرزند برای: {tree.find((n) => n.id === childForm.parentId)?.name ?? childForm.parentId}</span>
              <label className="text-xs font-bold text-ink/70">کد<input value={childForm.code} onChange={(e) => setChildForm({ ...childForm, code: e.target.value })} className="mt-1 w-24 rounded-xl border border-line bg-surface px-2 py-1.5 text-sm" dir="ltr" /></label>
              <label className="text-xs font-bold text-ink/70">نام<input value={childForm.name} onChange={(e) => setChildForm({ ...childForm, name: e.target.value })} className="mt-1 w-48 rounded-xl border border-line bg-surface px-2 py-1.5 text-sm" /></label>
              <button onClick={() => void createChild()} disabled={!childForm.code || !childForm.name} className="h-9 rounded-full bg-primary px-5 text-xs font-black text-on-accent disabled:opacity-50">ایجاد</button>
              <button onClick={() => setChildForm({ parentId: null, code: "", name: "" })} className="h-9 rounded-full border border-line px-4 text-xs font-bold text-ink/60">انصراف</button>
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-right text-xs text-ink/60">
                <th className="px-4 py-3">کد</th><th className="px-4 py-3">حساب</th><th className="px-4 py-3">نوع</th><th className="px-4 py-3">بدهکار</th><th className="px-4 py-3">بستانکار</th><th className="px-4 py-3">عملیات</th>
              </tr></thead>
              <tbody>
                {tree.length === 0 ? <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/50">حسابی ثبت نشده است.</td></tr> : tree.map((n) => renderNode(n, 0))}
              </tbody>
            </table>
          </div>
          {ledger ? (
            <div className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black" dir="ltr">{ledger.account.code} — {ledger.account.name} {!ledger.account.isActive ? <span className="text-[10px] text-app-err">(غیرفعال)</span> : null}</h4>
                <button onClick={() => setLedger(null)} className="text-xs font-bold text-ink/50">بستن ✕</button>
              </div>
              <table className="mt-3 w-full text-xs">
                <tbody>
                  {ledger.items.length === 0 ? <tr><td className="py-3 text-ink/50">گردشی ثبت نشده است.</td></tr> : ledger.items.map((l) => (
                    <tr key={`${l.entryId}-${l.debit}-${l.credit}`} className="border-b border-line/50 last:border-0">
                      <td className="py-1.5" dir="ltr">{l.entryNumber}{l.entryState === "DRAFT" ? " (پیش‌نویس)" : ""}</td>
                      <td className="py-1.5 text-ink/60">{new Date(l.date).toLocaleDateString("fa-IR")} — {l.description ?? ""}</td>
                      <td className="py-1.5 text-left tabular-nums">{Number(l.debit) ? fa(l.debit) : ""}</td>
                      <td className="py-1.5 text-left tabular-nums">{Number(l.credit) ? fa(l.credit) : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "payroll" ? (
        <form onSubmit={submitPayroll} className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">ثبت حقوق و دستمزد</h3>
          <p className="mt-1 text-xs text-ink/50">سند اتوماتیک: Dr هزینه عملیاتی / Cr حساب‌های پرداختنی.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="text-xs font-bold text-ink/70">نام کارمند<input value={payroll.employeeName} onChange={(e) => setPayroll({ ...payroll, employeeName: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">عنوان<input value={payroll.title} onChange={(e) => setPayroll({ ...payroll, title: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" /></label>
            <label className="text-xs font-bold text-ink/70">مبلغ (تومان)<input type="number" value={payroll.amount} onChange={(e) => setPayroll({ ...payroll, amount: e.target.value })} required min={1} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" /></label>
          </div>
          <button type="submit" className="mt-4 h-10 rounded-full bg-primary px-6 text-sm font-black text-on-accent">ثبت سند حقوق</button>
        </form>
      ) : null}
    </div>
  );
}
