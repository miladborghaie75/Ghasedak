"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

/**
 * سازندهٔ ماتریس واریانت از روی ویژگی‌های از پیش تعریف‌شده.
 *
 * مسئله‌ای که این جزء حل می‌کند: قبلاً برای هر واریantine باید SKU و
 * موجودی دستی تایپ می‌شد و مهم‌تر از همه **هیچ راهی نبود که بگویی این
 * واریانت «سایز ۷۵» و «رنگ قرمز» است**. بدون اتصال به `AttributeTerm`،
 * فروشگاه هرگز محور رنگ/سایز نمی‌ساخت و مشتری نمی‌توانست انتخاب کند.
 *
 * جریان کار:
 *   ۱) ویژگی‌های موجود («رنگ»، «سایز»، «نوع سوتین»…) از بخش ویژگی‌ها خوانده می‌شود
 *   ۲) هر محور را روشن/خاموش می‌کنی و مقادیرش را انتخاب می‌کنی
 *   ۳) دکمهٔ «ساخت پیش‌نویس» جدول همهٔ ترکیب‌ها را با SKU پیشنهادی می‌سازد
 *   ۴) جدول قابل ویرایش است و با ذخیرهٔ محصول، واریانت‌ها ساخته می‌شوند
 */

export interface AttributeTerm {
  id: string;
  value: string;
  slug: string;
  hex: string | null;
  sortOrder: number;
}

export interface AttributeRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  isVariantAxis: boolean;
  terms: AttributeTerm[];
}

export interface MatrixCombo {
  terms: Array<{ termId: string; value: string; attributeName: string }>;
  sku: string;
  price: string;
}

export interface MatrixRow {
  sku: string;
  price: string;
  stockQty: string;
  termIds: string[];
  /** برچسب محورها برای نمایش در جدول */
  labels: string[];
}

export default function VariantMatrix({
  productId,
  defaultPrice,
  existing,
  onApply,
}: {
  /** برای محصول تازه لازم نیست (هنوز id ندارد) */
  productId?: string;
  defaultPrice: string;
  /** واریانت‌های فعلی محصول تا اگر کاربر ماتریس را عوض کرد چیزی گم نشود */
  existing?: Array<{ id: string; sku: string; price: string; stockQty: string; termIds: string[] }>;
  onApply: (rows: MatrixRow[]) => void;
}) {
  const { call, loading } = useAdminApi();
  const [attrs, setAttrs] = useState<AttributeRow[]>([]);
  const [enabled, setEnabled] = useState<Record<string, string[]>>({});
  const [rows, setRows] = useState<MatrixRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await call<{ items: AttributeRow[] }>("/admin/catalog/attributes");
      if (r.ok && r.data) {
        // فقط ویژگی‌هایی که مقدار دارند — محور بدون مقدار بی‌معنی است
        setAttrs(r.data.items.filter((a) => a.terms.length > 0));
      }
    })();
  }, [call]);

  const toggleTerm = useCallback((attributeId: string, termId: string) => {
    setEnabled((prev) => {
      const cur = prev[attributeId] ?? [];
      const next = cur.includes(termId) ? cur.filter((t) => t !== termId) : [...cur, termId];
      return { ...prev, [attributeId]: next };
    });
  }, []);

  const toggleAxis = useCallback((attributeId: string) => {
    setEnabled((prev) => {
      const next = { ...prev };
      if (next[attributeId]) delete next[attributeId];
      else next[attributeId] = [];
      return next;
    });
  }, []);

  const activeAxes = useMemo(
    () => attrs.filter((a) => enabled[a.id]),
    [attrs, enabled],
  );

  const build = async () => {
    const axes = activeAxes.map((a) => ({ attributeId: a.id, termIds: enabled[a.id] ?? [] }));
    const usable = axes.filter((a) => a.termIds.length > 0);
    if (usable.length === 0) {
      setMsg("اول حداقل یک محور را روشن کن و از هر محور یک مقدار انتخاب کن.");
      return;
    }
    if (!productId) {
      setMsg("برای محصول تازه اول محصول را ذخیره کن، بعد ماتریس بساز.");
      return;
    }
    const r = await call<{ axes: Array<{ attributeName: string }>; combos: MatrixCombo[] }>(
      `/admin/products/${productId}/variant-matrix`,
      { method: "POST", body: JSON.stringify({ axes: usable }) },
    );
    if (!r.ok || !r.data) {
      setMsg(r.error?.message ?? "ساخت ماتریس ناموفق");
      return;
    }
    const labels = r.data.axes.map((a) => a.attributeName);
    setRows(
      r.data.combos.map((c) => ({
        sku: c.sku,
        price: c.price || defaultPrice,
        stockQty: "0",
        termIds: c.terms.map((t) => t.termId),
        labels: c.terms.map((t) => t.value),
      })),
    );
    setMsg(
      `${r.data.combos.length} ترکیب ساخته شد (محورها: ${labels.join(" × ")}). قیمت و موجودی هر ردیف را می‌توانی ویرایش کنی.`,
    );
  };

  const setRow = (i: number, patch: Partial<MatrixRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const removeRow = (i: number) => setRows((prev) => prev.filter((_, j) => j !== i));

  /** ادغام با واریانت‌های موجود — تا ویرایش محصول چیزی را پاک نکند */
  const apply = () => {
    const merged = [...rows];
    const seen = new Set(rows.map((r) => r.sku));
    for (const e of existing ?? []) {
      if (!seen.has(e.sku)) merged.push({ sku: e.sku, price: e.price, stockQty: e.stockQty, termIds: e.termIds ?? [], labels: [] });
    }
    onApply(merged);
    setMsg(`${merged.length} واریانت اعمال شد. حالا «ذخیره» را بزن.`);
  };

  return (
    <div className="mt-3 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black text-ink">ساخت واریانت از روی ویژگی‌ها</p>
        <button
          type="button"
          onClick={() => void build()}
          disabled={loading || activeAxes.length === 0}
          className="h-8 rounded-full bg-primary px-4 text-xs font-black text-on-accent disabled:opacity-40"
        >
          ساخت پیش‌نویس ماتریس
        </button>
      </div>

      {attrs.length === 0 ? (
        <p className="mt-2 text-xs text-ink/60">
          هنوز ویژگی‌ای با مقدار تعریف نشده. اول از بخش «ویژگی‌ها» مثلاً «رنگ» با
          مقادیر قرمز/آبی و «سایز» با ۷۰ تا ۸۵ بساز.
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {attrs.map((a) => {
            const on = !!enabled[a.id];
            const picked = enabled[a.id] ?? [];
            return (
              <div key={a.id} className="rounded-lg border border-line bg-app-bg/50 p-2">
                <label className="flex items-center gap-2 text-xs font-bold">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleAxis(a.id)}
                    className="size-4 accent-[var(--app-primary)]"
                  />
                  {a.name}
                  <span className="text-[10px] font-normal text-ink/50">
                    ({a.terms.length} مقدار{on && picked.length ? ` — ${picked.length} انتخاب‌شده` : ""})
                  </span>
                </label>
                {on && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.terms.map((t) => {
                      const isOn = picked.includes(t.id);
                      return (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => toggleTerm(a.id, t.id)}
                          className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${
                            isOn
                              ? "border-primary bg-primary text-on-accent"
                              : "border-line bg-surface text-ink/70"
                          }`}
                        >
                          {t.hex && (
                            <span
                              className="size-2.5 rounded-full border border-line"
                              style={{ background: t.hex }}
                              aria-hidden
                            />
                          )}
                          {t.value}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {msg && <p className="mt-2 text-[11px] leading-5 text-ink/70">{msg}</p>}

      {rows.length > 0 && (
        <div className="mt-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-line text-ink/60">
                  <th className="p-2 text-right">ویژگی‌ها</th>
                  <th className="p-2 text-right">SKU</th>
                  <th className="p-2">قیمت</th>
                  <th className="p-2">موجودی</th>
                  <th className="p-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-line/40">
                    <td className="p-2 font-bold">{r.labels.join(" · ") || "—"}</td>
                    <td className="p-2">
                      <input
                        value={r.sku}
                        dir="ltr"
                        onChange={(e) => setRow(i, { sku: e.target.value })}
                        className="w-40 rounded border border-line px-2 py-1 text-[11px]"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={r.price}
                        dir="ltr"
                        type="number"
                        onChange={(e) => setRow(i, { price: e.target.value })}
                        className="w-24 rounded border border-line px-2 py-1 text-[11px]"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={r.stockQty}
                        dir="ltr"
                        type="number"
                        onChange={(e) => setRow(i, { stockQty: e.target.value })}
                        className="w-20 rounded border border-line px-2 py-1 text-[11px]"
                      />
                    </td>
                    <td className="p-2 text-center">
                      <button type="button" onClick={() => removeRow(i)} className="text-[11px] font-bold text-app-err">
                        حذف
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            onClick={apply}
            className="mt-2 h-8 rounded-full border border-primary px-4 text-xs font-black text-primary"
          >
            اعمال روی فرم ({rows.length} واریانت)
          </button>
        </div>
      )}
    </div>
  );
}