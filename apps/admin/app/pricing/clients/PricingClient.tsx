"use client";

/**
 * قیمت‌گذاری کانالی — بند ۱۵: سطح‌های قیمت، تغییر با reason + history، permission per-level سمت سرور.
 * همه اعداد از API واقعی؛ هیچ قیمت ساختگی.
 */
import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface Level {
  id: string; code: string; name: string; active: boolean;
  restriction: { adminRoles?: string[] } | null;
  channels: Array<{ slug: string; name: string; active: boolean }>;
}
interface VariantRow {
  sku: string; barcode: string | null; productName: string;
  basePrice: string | number; levelPrice: string | number | null;
  levelSalePrice: string | number | null; saleStartsAt: string | null; saleEndsAt: string | null;
}
interface HistoryRow {
  id: string; oldPrice: string; newPrice: string; reason: string | null;
  actorId: string | null; createdAt: string; productName: string;
}

export default function PricingClient() {
  const { call, loading, permissions } = useAdminApi();
  const [levels, setLevels] = useState<Level[]>([]);
  const [level, setLevel] = useState("WEB");
  const [rows, setRows] = useState<VariantRow[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [historySku, setHistorySku] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({ mode: "percent", amount: 0, salePrice: "", clearSale: false, reason: "" });
  const canManage = (permissions ?? []).includes("pricing.manage");

  const loadLevels = useCallback(async () => {
    const r = await call<{ items: Level[] }>("/admin/pricing/levels");
    if (r.ok && r.data) setLevels(r.data.items);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadRows = useCallback(async () => {
    setError("");
    const r = await call<{ items: VariantRow[] }>(
      `/admin/pricing/variants?level=${encodeURIComponent(level)}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    );
    if (r.ok && r.data) setRows(r.data.items); else setError(r.error?.message ?? "خطا");
  }, [level, q]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadHistory = useCallback(async (sku: string) => {
    const r = await call<{ items: HistoryRow[] }>(`/admin/pricing/history/${encodeURIComponent(sku)}?level=${encodeURIComponent(level)}`);
    if (r.ok && r.data) setHistory(r.data.items);
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void loadLevels(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void loadRows(); setSelected(new Set()); }, [loadRows]);

  const toggle = (sku: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku); else next.add(sku);
      return next;
    });
  };

  const apply = async () => {
    setError(""); setMsg("");
    const body: Record<string, unknown> = {
      skus: [...selected],
      levelCode: level,
      mode: form.mode,
      amount: Number(form.amount),
      reason: form.reason || null,
    };
    if (form.clearSale) body.clearSale = true;
    else if (form.salePrice !== "") body.salePrice = Number(form.salePrice);
    const r = await call<{ changed: number }>("/admin/pricing/change", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (r.ok && r.data) {
      setMsg(`قیمت ${fa(r.data.changed)} کالا به‌روزرسانی و در تاریخچه ثبت شد ✅`);
      setSelected(new Set());
      await loadRows();
    } else setError(r.error?.message ?? "خطا");
  };

  const showHistory = async (sku: string) => {
    setHistorySku(sku);
    await loadHistory(sku);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* انتخاب سطح */}
      <div className="flex flex-wrap items-center gap-2">
        {levels.map((l) => (
          <button
            key={l.code}
            onClick={() => setLevel(l.code)}
            aria-pressed={level === l.code}
            className={`rounded-full px-4 py-1.5 text-xs font-bold ${level === l.code ? "bg-primary text-on-accent" : "border border-line text-ink hover:bg-app-primary-soft"}`}
          >
            {l.name}
            <span className="ms-1 text-[10px] opacity-70" dir="ltr">{l.code}</span>
          </button>
        ))}
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="جستجوی SKU/بارکد/نام"
          className="ms-auto h-9 w-56 rounded-lg border border-line bg-surface px-3 text-xs"
        />
      </div>

      {msg && <p className="rounded-xl border border-app-ok/40 bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p>}
      {error && <p className="rounded-xl border border-app-err/40 bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p>}

      {/* فرم تغییر — فقط با pricing.manage */}
      {canManage && selected.size > 0 && (
        <div className="rounded-card border border-line bg-surface p-4">
          <h3 className="mb-2 text-sm font-black">
            تغییر قیمت {fa(selected.size)} کالا — سطح <span dir="ltr">{level}</span>
          </h3>
          <div className="grid grid-cols-2 items-end gap-2 md:grid-cols-5">
            <label className="text-[11px] font-bold">
              نوع
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs"
              >
                <option value="percent">درصدی (٪)</option>
                <option value="delta">تغییر مبلغی (±تومان)</option>
                <option value="absolute">قیمت قطعی (تومان)</option>
              </select>
            </label>
            <label className="text-[11px] font-bold">
              مقدار
              <input
                type="number"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })}
                className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs tnum"
                dir="ltr"
              />
            </label>
            <label className="text-[11px] font-bold">
              فروش ویژه (خالی = بدون تغییر)
              <input
                type="number"
                value={form.salePrice}
                onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs tnum"
                dir="ltr"
              />
            </label>
            <label className="flex items-center gap-2 pb-2 text-[11px] font-bold">
              <input
                type="checkbox"
                checked={form.clearSale}
                onChange={(e) => setForm({ ...form, clearSale: e.target.checked })}
                className="size-4"
              />
              حذف فروش ویژه
            </label>
            <label className="text-[11px] font-bold">
              دلیل (در تاریخچه ثبت می‌شود)
              <input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="مثلاً: افزایش نرخ تامین‌کننده"
                className="mt-1 h-9 w-full rounded-lg border border-line bg-surface px-2 text-xs"
              />
            </label>
          </div>
          <button
            onClick={() => void apply()}
            disabled={loading}
            className="mt-3 h-9 rounded-full bg-primary px-5 text-xs font-bold text-on-accent disabled:opacity-50"
          >
            اعمال تغییر قیمت
          </button>
        </div>
      )}

      {/* جدول واریانت‌ها */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              {canManage && <th className="px-3 py-3"></th>}
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">محصول</th>
              <th className="px-4 py-3">قیمت پایه</th>
              <th className="px-4 py-3">قیمت این سطح</th>
              <th className="px-4 py-3">فروش ویژه</th>
              <th className="px-4 py-3">تاریخچه</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.sku} className="border-b border-line/60 last:border-0">
                {canManage && (
                  <td className="px-3 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(v.sku)}
                      onChange={() => toggle(v.sku)}
                      aria-label={`انتخاب ${v.sku}`}
                      className="size-4"
                    />
                  </td>
                )}
                <td className="px-4 py-3 font-mono text-[11px]" dir="ltr">{v.sku}</td>
                <td className="px-4 py-3 text-xs">{v.productName}</td>
                <td className="px-4 py-3 tnum text-xs text-ink/60">{fa(Number(v.basePrice))}</td>
                <td className="px-4 py-3 font-bold tnum">{v.levelPrice != null ? fa(Number(v.levelPrice)) : "—"}</td>
                <td className="px-4 py-3 tnum text-xs text-app-ok">
                  {v.levelSalePrice != null ? fa(Number(v.levelSalePrice)) : "—"}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => void showHistory(v.sku)}
                    className="rounded-full border border-line px-2 py-1 text-[10px] font-bold"
                  >
                    مشاهده
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={canManage ? 7 : 6} className="px-4 py-8 text-center text-ink/50">واریانتی یافت نشد.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* تاریخچه */}
      {historySku && (
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-black">
              تاریخچه قیمت <span dir="ltr" className="font-mono text-xs">{historySku}</span> — سطح {level}
            </h3>
            <button onClick={() => { setHistorySku(null); setHistory([]); }} className="text-[11px] font-bold text-primary-strong">
              بستن
            </button>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-line text-right text-ink/60">
                <th className="py-2">قبلی</th>
                <th className="py-2">جدید</th>
                <th className="py-2">دلیل</th>
                <th className="py-2">زمان</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-b border-line/40 last:border-0">
                  <td className="py-2 tnum">{fa(Number(h.oldPrice))}</td>
                  <td className="py-2 tnum font-bold">{fa(Number(h.newPrice))}</td>
                  <td className="py-2">{h.reason ?? "—"}</td>
                  <td className="py-2 text-ink/60" dir="ltr">{new Date(h.createdAt).toLocaleString("fa-IR")}</td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-ink/50">تغییری ثبت نشده است.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
