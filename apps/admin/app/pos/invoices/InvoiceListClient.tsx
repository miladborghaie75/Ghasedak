"use client";

/**
 * فاز ۱۰ — بخش ۷: لیست عملیاتی فاکتورهای POS.
 * جستجو (شماره/موبایل/نام)، فیلتر روش پرداخت/وضعیت، بازهٔ امروز/هفته/ماه/دلخواه.
 */

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface Row {
  id: string; number: string; state: string; grandTotal: string; customerName: string | null;
  customerMobile: string | null; createdAt: string; revision: number;
  cashier?: { name: string | null } | null;
  payments: Array<{ method: string; amount: string }>;
}

const METHOD_FA: Record<string, string> = { CASH: "نقدی", CARD: "کارت", ONLINE: "آنلاین", BANK_TRANSFER: "کارت به کارت", CHECK: "چک", CREDIT: "اعتباری", WALLET: "کیف پول" };

export default function InvoiceListClient() {
  const { call } = useAdminApi();
  const [rows, setRows] = useState<Row[]>([]);
  const [q, setQ] = useState("");
  const [method, setMethod] = useState("");
  const [state, setState] = useState("");
  const [preset, setPreset] = useState<"today" | "week" | "month" | "custom">("today");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const range = useCallback((): { from?: string; to?: string } => {
    const now = new Date();
    const day = 86_400_000;
    if (preset === "today") {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return { from: start.toISOString(), to: new Date(start.getTime() + day).toISOString() };
    }
    if (preset === "week") return { from: new Date(now.getTime() - 7 * day).toISOString() };
    if (preset === "month") return { from: new Date(now.getTime() - 30 * day).toISOString() };
    return { ...(from ? { from: new Date(from).toISOString() } : {}), ...(to ? { to: new Date(to).toISOString() } : {}) };
  }, [preset, from, to]);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (method) qs.set("method", method);
    if (state) qs.set("state", state);
    const r = range();
    if (r.from) qs.set("from", r.from);
    if (r.to) qs.set("to", r.to);
    const res = await call<{ items: Row[] }>(`/pos/invoices/search?${qs}`);
    if (res.ok && res.data) { setRows(res.data.items); setError(null); }
    else setError(res.error?.message ?? "خطا");
  }, [call, q, method, state, range]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line p-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="شماره فاکتور / موبایل / نام…" className="h-9 w-64 rounded-xl border border-line px-3 text-xs" />
        <select value={method} onChange={(e) => setMethod(e.target.value)} className="h-9 rounded-xl border border-line bg-surface px-2 text-xs">
          <option value="">همهٔ روش‌ها</option>
          {["CASH", "CARD", "ONLINE", "BANK_TRANSFER", "CHECK"].map((m) => <option key={m} value={m}>{METHOD_FA[m]}</option>)}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value)} className="h-9 rounded-xl border border-line bg-surface px-2 text-xs">
          <option value="">همهٔ وضعیت‌ها</option>
          <option value="FINALIZED">نهایی</option>
          <option value="CANCELLED">لغو</option>
        </select>
        <div className="flex gap-1">
          {([["today", "امروز"], ["week", "این هفته"], ["month", "این ماه"], ["custom", "بازه"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setPreset(k)} className={`h-9 rounded-full px-3 text-xs font-bold ${preset === k ? "bg-primary text-on-accent" : "border border-line"}`}>{label}</button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="flex items-center gap-1">
            <input value={from} onChange={(e) => setFrom(e.target.value)} type="date" className="h-9 rounded-xl border border-line px-2 text-xs" />
            <span className="text-xs text-ink/40">تا</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} type="date" className="h-9 rounded-xl border border-line px-2 text-xs" />
          </div>
        ) : null}
      </div>

      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-line">
        <div className="admin-table-wrap"><table className="w-full text-xs">
          <thead className="bg-primary-tint/60"><tr className="text-ink/60">
            <th className="p-2 text-right">شماره</th><th>تاریخ</th><th>مشتری</th><th>روش‌ها</th><th>کاشیر</th><th>وضعیت</th><th>مبلغ</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-line/60 hover:bg-primary-soft/40">
                <td className="p-2 text-right">
                  <a href={`/pos/${encodeURIComponent(r.number)}`} className="font-black text-primary-strong underline" dir="ltr">{r.number}</a>
                  {r.revision > 1 ? <span className="ms-1 text-[10px] text-ink/40">rev{fa(r.revision)}</span> : null}
                </td>
                <td className="text-center">{new Date(r.createdAt).toLocaleString("fa-IR")}</td>
                <td className="text-center">{r.customerName ?? r.customerMobile ?? "—"}</td>
                <td className="text-center">{r.payments.map((p) => METHOD_FA[p.method] ?? p.method).join(" + ")}</td>
                <td className="text-center">{r.cashier?.name ?? "—"}</td>
                <td className="text-center">{r.state === "FINALIZED" ? "نهایی" : r.state === "CANCELLED" ? "لغو" : r.state}</td>
                <td className="text-center font-black tabular-nums">{fa(r.grandTotal)}</td>
              </tr>
            ))}
            {rows.length === 0 ? <tr><td colSpan={7} className="p-6 text-center text-ink/40">فاکتوری در این بازه نیست.</td></tr> : null}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
