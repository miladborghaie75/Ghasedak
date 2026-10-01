"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface Profit {
  from: string;
  to: string;
  revenue: string;
  cogs: string;
  grossProfit: string;
  expenses: string;
  netProfit: string;
  grossMargin: number | null;
  netMargin: number | null;
  itemsTotal: number;
  itemsWithCost: number;
  itemsMissingCost: number;
  missingCostSkus: string[];
  perSku: Array<{ sku: string; name: string; qty: number; revenue: string; cogs: string | null; profit: string | null }>;
  perOrder: Array<{ code: string; createdAt: string; revenue: string; cogs: string | null; profit: string | null }>;
}

/** کارت سود واقعی — اعداد کلی از GL، جزئیات SKU از بهای میانگین انبار؛ بدون هیچ عدد ساختگی */
export default function ProfitClient() {
  const { call, loading } = useAdminApi();
  const [data, setData] = useState<Profit | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = async (q = "") => {
    setError(null);
    const r = await call<Profit>(`/admin/reports/profit${q}`);
    if (r.ok && r.data) setData(r.data);
    else setError(r.error?.message ?? "خطا در دریافت گزارش");
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!data) return <p className="p-6 text-sm text-muted">{loading ? "در حال بارگذاری…" : error ?? "—"}</p>;

  const missingPct = data.itemsTotal > 0 ? Math.round((data.itemsMissingCost / data.itemsTotal) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-muted">
          از
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="mt-1 block rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
        <label className="text-xs text-muted">
          تا
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="mt-1 block rounded-card border border-line bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            const qs = new URLSearchParams();
            if (from) qs.set("from", new Date(from).toISOString());
            if (to) qs.set("to", new Date(to + "T23:59:59").toISOString());
            void load(qs.toString() ? `?${qs.toString()}` : "");
          }}
          className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-on-accent"
        >
          اعمال بازه
        </button>
        {error ? <span className="text-xs text-app-err">{error}</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-xs text-muted">فروش سفارش‌ها</p>
          <p className="mt-1 text-lg font-black tabular-nums text-ink">{fa(data.revenue)}</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-xs text-muted">بهای تمام‌شدهٔ فروش</p>
          <p className="mt-1 text-lg font-black tabular-nums text-ink">{fa(data.cogs)}</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-xs text-muted">سود ناخالص</p>
          <p className="mt-1 text-lg font-black tabular-nums text-app-ok">{fa(data.grossProfit)}</p>
          <p className="text-[11px] text-muted">{data.grossMargin != null ? `حاشیه ${fa(data.grossMargin)}٪` : "—"}</p>
        </div>
        <div className="rounded-card border border-line bg-surface p-4">
          <p className="text-xs text-muted">سود خالص (پس از هزینه‌ها)</p>
          <p className="mt-1 text-lg font-black tabular-nums text-ink">{fa(data.netProfit)}</p>
          <p className="text-[11px] text-muted">{data.netMargin != null ? `حاشیه ${fa(data.netMargin)}٪` : "—"}</p>
        </div>
      </div>

      {data.itemsMissingCost > 0 ? (
        <p className="rounded-card border border-app-warning/30 bg-app-warning/5 px-4 py-2 text-xs leading-6 text-ink">
          {fa(data.itemsMissingCost)} از {fa(data.itemsTotal)} سفارش پرداخت‌شده بهای ثبت‌شده در دفتر انبار ندارد
          {data.missingCostSkus.length > 0 ? ` (SKUها: ${data.missingCostSkus.join("، ")})` : ""} — برای این سطرها سود
          واقعی نامشخص است؛ با ثبت خرید/موجودی آغازین بهایی، شمرده می‌شوند.
        </p>
      ) : null}

      <section className="rounded-card border border-line bg-surface">
        <h3 className="border-b border-line px-5 py-3 font-display text-sm font-bold text-ink">
          سود به تفکیک کالا — {fa(data.itemsTotal)} سفارش پرداخت‌شده در بازه
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th className="p-2 text-start font-bold">کالا</th>
                <th className="p-2 text-start font-bold">SKU</th>
                <th className="p-2 text-start font-bold">تعداد فروش</th>
                <th className="p-2 text-start font-bold">فروش</th>
                <th className="p-2 text-start font-bold">بهای تمام‌شده</th>
                <th className="p-2 text-start font-bold">سود</th>
              </tr>
            </thead>
            <tbody>
              {data.perSku.map((r) => (
                <tr key={r.sku} className="border-t border-line">
                  <td className="p-2 font-bold text-ink">{r.name}</td>
                  <td className="p-2 text-muted" dir="ltr">{r.sku}</td>
                  <td className="p-2 tabular-nums text-ink">{fa(r.qty)}</td>
                  <td className="p-2 tabular-nums text-ink">{fa(r.revenue)}</td>
                  <td className="p-2 tabular-nums text-ink">{r.cogs != null ? fa(r.cogs) : <span className="text-muted">نامشخص</span>}</td>
                  <td className="p-2 tabular-nums font-bold text-app-ok">{r.profit != null ? fa(r.profit) : <span className="text-muted">نامشخص</span>}</td>
                </tr>
              ))}
              {data.perSku.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-4 text-center text-muted">در این بازه سفارش پرداخت‌شده‌ای نیست.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface">
        <h3 className="border-b border-line px-5 py-3 font-display text-sm font-bold text-ink">سفارش‌های اخیر بازه</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted">
              <tr>
                <th className="p-2 text-start font-bold">کد سفارش</th>
                <th className="p-2 text-start font-bold">تاریخ</th>
                <th className="p-2 text-start font-bold">فروش</th>
                <th className="p-2 text-start font-bold">سود</th>
              </tr>
            </thead>
            <tbody>
              {data.perOrder.map((o) => (
                <tr key={o.code} className="border-t border-line">
                  <td className="p-2 font-bold text-ink" dir="ltr">{o.code}</td>
                  <td className="p-2 text-muted">{new Date(o.createdAt).toLocaleDateString("fa-IR")}</td>
                  <td className="p-2 tabular-nums text-ink">{fa(o.revenue)}</td>
                  <td className="p-2 tabular-nums font-bold text-app-ok">{o.profit != null ? fa(o.profit) : <span className="text-muted">نامشخص</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
