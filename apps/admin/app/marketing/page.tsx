"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface CouponRow {
  id: string; code: string; type: string; amount: string | number;
  usageLimit: number | null; perCustomerLimit: number | null;
  minCartTotal: string | number | null; maxDiscount: string | number | null;
  active: boolean; startsAt: string | null; endsAt: string | null;
  _count: { redemptions: number };
}
interface SalesReport {
  onlinePaid: { count: number; total: string };
  pos: { count: number; total: string };
  daily: Array<{ date: string; online: number; pos: number; orders: number }>;
}

/** بازاریابی — کوپن (بند ۳۹) + گزارش فروش (بند ۳۱) */
export default function MarketingClient() {
  const { call, loading } = useAdminApi();
  const [coupons, setCoupons] = useState<CouponRow[]>([]);
  const [report, setReport] = useState<SalesReport | null>(null);
  const [msg, setMsg] = useState("");
  const [tab, setTab] = useState<"coupons" | "sales">("coupons");
  const [form, setForm] = useState({ code: "", type: "percent", amount: 10, usageLimit: "", minCartTotal: "", maxDiscount: "", endsAt: "" });

  const load = async () => {
    const [c, s] = await Promise.all([
      call<{ items: CouponRow[] }>("/admin/capabilities/coupons"),
      call<SalesReport>("/admin/capabilities/sales-report?days=30"),
    ]);
    if (c.ok && c.data) setCoupons(c.data.items);
    if (s.ok && s.data) setReport(s.data);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const create = async () => {
    const r = await call("/admin/capabilities/coupons", {
      method: "POST",
      body: JSON.stringify({
        code: form.code,
        type: form.type,
        amount: Number(form.amount),
        usageLimit: form.usageLimit ? Number(form.usageLimit) : null,
        minCartTotal: form.minCartTotal ? Number(form.minCartTotal) : null,
        maxDiscount: form.maxDiscount ? Number(form.maxDiscount) : null,
        endsAt: form.endsAt || null,
      }),
    });
    setMsg(r.ok ? "کوپن ساخته شد ✅" : r.error?.message ?? "خطا");
    if (r.ok) { setForm({ code: "", type: "percent", amount: 10, usageLimit: "", minCartTotal: "", maxDiscount: "", endsAt: "" }); await load(); }
  };

  const toggle = async (id: string) => { await call(`/admin/capabilities/coupons/${id}/toggle`, { method: "POST" }); await load(); };
  const remove = async (id: string) => {
    const r = await call(`/admin/capabilities/coupons/${id}`, { method: "DELETE" });
    setMsg(r.ok ? "حذف شد." : r.error?.message ?? "خطا");
    if (r.ok) await load();
  };

  const maxDaily = Math.max(1, ...(report?.daily ?? []).map((d) => d.online + d.pos));

  return (
    <div className="space-y-5">
      {msg && <div className="rounded-card border border-line bg-surface px-4 py-2 text-sm">{msg}</div>}

      <div className="flex gap-2">
        {([["coupons", "کدهای تخفیف"], ["sales", "گزارش فروش"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-4 py-2 text-xs font-bold ${tab === k ? "bg-primary text-on-accent" : "border border-line bg-surface text-muted"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "coupons" && (
        <>
          <section className="rounded-card border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-bold text-ink">کد تخفیف جدید</h3>
            <div className="flex flex-wrap items-end gap-2">
              <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                placeholder="کد (مثلاً YALDA1405)" className="w-44 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
                <option value="percent">درصدی</option>
                <option value="fixed">مبلغی (تومان)</option>
              </select>
              <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                placeholder="مقدار" className="w-24 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
              <input type="number" value={form.usageLimit} onChange={(e) => setForm({ ...form, usageLimit: e.target.value })}
                placeholder="سقف استفاده" className="w-28 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
              <input type="number" value={form.minCartTotal} onChange={(e) => setForm({ ...form, minCartTotal: e.target.value })}
                placeholder="حداقل سبد" className="w-28 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
              <input type="number" value={form.maxDiscount} onChange={(e) => setForm({ ...form, maxDiscount: e.target.value })}
                placeholder="سقف تخفیف" className="w-28 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
              <input type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
                className="rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
              <button onClick={() => void create()} disabled={loading} className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-accent">ایجاد</button>
            </div>
          </section>

          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-bg text-xs text-muted">
                <th className="p-3 text-start">کد</th><th className="p-3">نوع</th><th className="p-3">مقدار</th>
                <th className="p-3">استفاده</th><th className="p-3">سقف</th><th className="p-3">وضعیت</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id} className="border-b border-line/50 last:border-0">
                    <td className="p-3 font-mono font-bold">{c.code}</td>
                    <td className="p-3 text-center">{c.type === "percent" ? "درصدی" : "مبلغی"}</td>
                    <td className="p-3 text-center">{fa(String(c.amount))}{c.type === "percent" ? "٪" : ""}</td>
                    <td className="p-3 text-center">{fa(c._count.redemptions)}</td>
                    <td className="p-3 text-center">{c.usageLimit ? fa(c.usageLimit) : "∞"}</td>
                    <td className="p-3 text-center">
                      <button onClick={() => void toggle(c.id)}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${c.active ? "bg-app-primary-soft text-app-ink" : "bg-app-line text-app-muted"}`}>
                        {c.active ? "فعال" : "غیرفعال"}
                      </button>
                    </td>
                    <td className="p-3 text-center">
                      <button onClick={() => void remove(c.id)} className="text-[11px] font-bold text-app-err">حذف</button>
                    </td>
                  </tr>
                ))}
                {coupons.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">هنوز کد تخفیفی ساخته نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "sales" && report && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["سفارش پرداخت‌شده (۳۰ روز)", fa(report.onlinePaid.count)],
              ["فروش آنلاین", `${fa(report.onlinePaid.total)} تومان`],
              ["فاکتور POS", fa(report.pos.count)],
              ["فروش حضوری", `${fa(report.pos.total)} تومان`],
            ].map(([label, val]) => (
              <div key={label} className="rounded-card border border-line bg-surface p-4">
                <p className="text-[11px] text-muted">{label}</p>
                <p className="mt-1 font-display text-lg font-bold text-ink">{val}</p>
              </div>
            ))}
          </div>
          <section className="rounded-card border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-bold text-ink">روند روزانه (آنلاین + حضوری)</h3>
            <div className="flex h-40 items-end gap-1">
              {report.daily.length === 0 && <p className="text-sm text-muted">هنوز داده‌ای برای نمایش وجود ندارد.</p>}
              {report.daily.map((d) => {
                const total = d.online + d.pos;
                return (
                  <div key={d.date} className="group relative flex-1" title={`${d.date}: ${fa(total)} تومان`}>
                    <div className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary" style={{ height: `${Math.max(4, (total / maxDaily) * 150)}px` }} />
                    {d.pos > 0 && (
                      <div className="absolute bottom-0 w-full rounded-t bg-plum/50" style={{ height: `${Math.max(2, (d.pos / maxDaily) * 150)}px` }} />
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-muted">بنفش روشن: آنلاین — بنفش تیره: فروش حضوری POS</p>
          </section>
        </>
      )}
    </div>
  );
}
