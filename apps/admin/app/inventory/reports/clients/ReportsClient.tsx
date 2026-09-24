"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface ValuationRow { warehouseCode: string; sku: string; productName: string; onHand: number; avgUnitCost: string; value: string }
interface DeadRow { sku: string; productName: string; stockQty: number; lastOutAt: string | null; daysSinceOut: number | null; value: string }
interface FastSlowRow { sku: string; productName: string; soldQty: number; stockQty: number; rank: string }
interface Turnover { days: number; turnover: number; daysOfStock: number; cogsWindow: string; avgInventoryValue: string }
interface AdjustRow { id: string; type: string; qtyIn: number; qtyOut: number; note: string | null; createdAt: string; warehouse: { code: string }; variant: { sku: string; product: { name: string } }; actor: { name: string | null } | null }
interface VarianceRow { number: string; closedAt: string | null; surplusLines: number; shortageLines: number; surplusQty: number; shortageQty: number; surplusValue: string; shortageValue: string }

type Tab = "valuation" | "dead" | "fastslow" | "turnover" | "adjustments" | "variance";

const TABS: Array<[Tab, string]> = [
  ["valuation", "ارزش‌گذاری موجودی"],
  ["dead", "کالای راکد"],
  ["fastslow", "پرفروش/کم‌فروش"],
  ["turnover", "گردش انبار"],
  ["adjustments", "تاریخچه تعدیل"],
  ["variance", "واریانس انبارگردانی"],
];

/** گزارش‌های انبار — همه از منبع حقیقت Ledger (بند ۱۰۶) */
export default function ReportsClient() {
  const { call, loading } = useAdminApi();
  const [tab, setTab] = useState<Tab>("valuation");
  const [error, setError] = useState<string | null>(null);
  const [valuation, setValuation] = useState<{ rows: ValuationRow[]; total: string } | null>(null);
  const [dead, setDead] = useState<{ days: number; rows: DeadRow[] } | null>(null);
  const [fastSlow, setFastSlow] = useState<{ days: number; rows: FastSlowRow[] } | null>(null);
  const [turnover, setTurnover] = useState<Turnover | null>(null);
  const [adjustments, setAdjustments] = useState<{ items: AdjustRow[]; total: number } | null>(null);
  const [variance, setVariance] = useState<{ rows: VarianceRow[] } | null>(null);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        if (tab === "valuation" && !valuation) {
          const r = await call<{ rows: ValuationRow[]; total: string }>("/admin/inventory-ops/reports/valuation");
          if (r.ok && r.data) setValuation(r.data);
        } else if (tab === "dead" && !dead) {
          const r = await call<{ days: number; rows: DeadRow[] }>("/admin/inventory-ops/reports/dead-stock");
          if (r.ok && r.data) setDead(r.data);
        } else if (tab === "fastslow" && !fastSlow) {
          const r = await call<{ days: number; rows: FastSlowRow[] }>("/admin/inventory-ops/reports/fast-slow");
          if (r.ok && r.data) setFastSlow(r.data);
        } else if (tab === "turnover" && !turnover) {
          const r = await call<Turnover>("/admin/inventory-ops/reports/turnover");
          if (r.ok && r.data) setTurnover(r.data);
        } else if (tab === "adjustments" && !adjustments) {
          const r = await call<{ items: AdjustRow[]; total: number }>("/admin/inventory-ops/reports/adjustments");
          if (r.ok && r.data) setAdjustments(r.data);
        } else if (tab === "variance" && !variance) {
          const r = await call<{ rows: VarianceRow[] }>("/admin/inventory-ops/reports/stocktake-variance");
          if (r.ok && r.data) setVariance(r.data);
        }
      } catch {
        setError("خطا در دریافت گزارش");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-4 py-2 text-xs font-bold ${tab === k ? "bg-primary text-white" : "border border-line bg-surface text-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-600">{error}</p> : null}
      {loading ? <p className="text-xs text-muted">در حال بارگذاری…</p> : null}

      {tab === "valuation" && valuation && (
        <>
          <div className="rounded-card border border-primary/30 bg-primary-tint/40 p-4 text-sm font-black">
            ارزش کل موجودی: {fa(valuation.total)} تومان
          </div>
          <div className="max-h-[32rem] overflow-auto rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">انبار</th><th className="p-3">کالا</th><th className="p-3">SKU</th><th className="p-3">موجودی</th><th className="p-3">میانگین بها</th><th className="p-3">ارزش</th>
              </tr></thead>
              <tbody>
                {valuation.rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/40 last:border-0">
                    <td className="p-3 text-xs">{r.warehouseCode}</td>
                    <td className="p-3 font-bold">{r.productName}</td>
                    <td className="p-3 text-xs" dir="ltr">{r.sku}</td>
                    <td className="p-3 text-center tabular-nums">{fa(r.onHand)}</td>
                    <td className="p-3 text-center tabular-nums text-xs">{fa(r.avgUnitCost)}</td>
                    <td className="p-3 text-center tabular-nums font-bold">{fa(r.value)}</td>
                  </tr>
                ))}
                {valuation.rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink/50">موجودی‌ای برای ارزش‌گذاری نیست.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "dead" && dead && (
        <>
          <p className="text-xs text-muted">کالاهای بدون هیچ خروجی در {fa(dead.days)} روز گذشته (از تنظیمات انبار خوانده می‌شود).</p>
          <div className="max-h-[32rem] overflow-auto rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">کالا</th><th className="p-3">SKU</th><th className="p-3">موجودی</th><th className="p-3">آخرین خروج</th><th className="p-3">روز از آخرین خروج</th><th className="p-3">ارزش راکد</th>
              </tr></thead>
              <tbody>
                {dead.rows.map((r) => (
                  <tr key={r.sku} className="border-b border-line/40 last:border-0">
                    <td className="p-3 font-bold">{r.productName}</td>
                    <td className="p-3 text-xs" dir="ltr">{r.sku}</td>
                    <td className="p-3 text-center tabular-nums">{fa(r.stockQty)}</td>
                    <td className="p-3 text-center text-xs">{r.lastOutAt ? new Date(r.lastOutAt).toLocaleDateString("fa-IR") : "هرگز"}</td>
                    <td className="p-3 text-center tabular-nums">{r.daysSinceOut != null ? fa(r.daysSinceOut) : "—"}</td>
                    <td className="p-3 text-center tabular-nums">{fa(r.value)}</td>
                  </tr>
                ))}
                {dead.rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink/50">کالای راکی یافت نشد ✅</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "fastslow" && fastSlow && (
        <>
          <p className="text-xs text-muted">پرفروش‌ها در {fa(fastSlow.days)} روز گذشته.</p>
          <div className="max-h-[32rem] overflow-auto rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">کالا</th><th className="p-3">SKU</th><th className="p-3">فروش</th><th className="p-3">موجودی</th><th className="p-3">رتبه</th>
              </tr></thead>
              <tbody>
                {fastSlow.rows.map((r) => (
                  <tr key={r.sku} className="border-b border-line/40 last:border-0">
                    <td className="p-3 font-bold">{r.productName}</td>
                    <td className="p-3 text-xs" dir="ltr">{r.sku}</td>
                    <td className="p-3 text-center tabular-nums">{fa(r.soldQty)}</td>
                    <td className="p-3 text-center tabular-nums">{fa(r.stockQty)}</td>
                    <td className="p-3 text-center text-xs font-bold">
                      {r.rank === "FAST" ? <span className="text-green-700">پرفروش</span> : r.rank === "SLOW" ? <span className="text-red-600">کم‌فروش</span> : "معمولی"}
                    </td>
                  </tr>
                ))}
                {fastSlow.rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink/50">فروشی در این بازه نبوده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "turnover" && turnover && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          {[
            ["بازه (روز)", fa(turnover.days)],
            ["گردش انبار", fa(turnover.turnover)],
            ["روزهای موجودی", fa(turnover.daysOfStock)],
            ["بهای کالای فروش‌رفته", fa(turnover.cogsWindow)],
            ["ارزش میانگین موجودی", fa(turnover.avgInventoryValue)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-card border border-line bg-surface p-4">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 text-lg font-black tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "adjustments" && adjustments && (
        <div className="max-h-[32rem] overflow-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface"><tr className="border-b border-line text-xs text-ink/60">
              <th className="p-3 text-right">تاریخ</th><th className="p-3">انبار</th><th className="p-3">کالا</th><th className="p-3">ورود</th><th className="p-3">خروج</th><th className="p-3">عامل</th><th className="p-3">توضیح</th>
            </tr></thead>
            <tbody>
              {adjustments.items.map((r) => (
                <tr key={r.id} className="border-b border-line/40 last:border-0">
                  <td className="p-3 text-xs">{new Date(r.createdAt).toLocaleDateString("fa-IR")}</td>
                  <td className="p-3 text-xs">{r.warehouse.code}</td>
                  <td className="p-3 text-xs">{r.variant.product.name}</td>
                  <td className="p-3 text-center tabular-nums text-green-700">{r.qtyIn > 0 ? fa(r.qtyIn) : "—"}</td>
                  <td className="p-3 text-center tabular-nums text-red-600">{r.qtyOut > 0 ? fa(r.qtyOut) : "—"}</td>
                  <td className="p-3 text-center text-xs">{r.actor?.name ?? "—"}</td>
                  <td className="p-3 text-xs text-muted">{r.note ?? "—"}</td>
                </tr>
              ))}
              {adjustments.items.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-ink/50">تعدیلی ثبت نشده است.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "variance" && variance && (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-xs text-ink/60">
              <th className="p-3 text-right">انبارگردانی</th><th className="p-3">مازاد</th><th className="p-3">کسری</th><th className="p-3">ارزش مازاد</th><th className="p-3">ارزش کسری</th><th className="p-3">تاریخ بستن</th>
            </tr></thead>
            <tbody>
              {variance.rows.map((r) => (
                <tr key={r.number} className="border-b border-line/60 last:border-0">
                  <td className="p-3 font-bold" dir="ltr">{r.number}</td>
                  <td className="p-3 text-center text-xs">{fa(r.surplusLines)} ردیف / {fa(r.surplusQty)} عدد</td>
                  <td className="p-3 text-center text-xs">{fa(r.shortageLines)} ردیف / {fa(r.shortageQty)} عدد</td>
                  <td className="p-3 text-center tabular-nums">{fa(r.surplusValue)}</td>
                  <td className="p-3 text-center tabular-nums text-red-600">{fa(r.shortageValue)}</td>
                  <td className="p-3 text-center text-xs">{r.closedAt ? new Date(r.closedAt).toLocaleDateString("fa-IR") : "—"}</td>
                </tr>
              ))}
              {variance.rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink/50">انبارگردانی بسته‌شده‌ای نیست.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
