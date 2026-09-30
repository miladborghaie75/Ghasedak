"use client";

/**
 * چاپ برچسب بارکد کالا — بند ۲۸/۱۱۶ Master (قاصدک: بارکد داخلی EAN-13):
 * - انتخاب واریانت‌ها از همان picker مشترک /admin/products/picker (نرمال‌سازی فارسی، DRAFT هم) — بدون endpoint جدید
 * - هر واریانت = یک لیبل: نام محصول + SKU/سایز + قیمت (تومان) + EAN-13 وکتور (components/print/Barcode)
 * - دو قالب چاپ واقعی: رول حرارتی ۵۰×۳۰ میلی‌متر و برگه A4 (شبکه ۳×۸ = ۲۴ لیبل در صفحه)
 * - تعداد کپی هر لیبل قابل تنظیم (چند برچسب برای یک واریانت)
 * چاپ با Ctrl+P روی استایل @media print در globals.css (قالب رول/A4 سوییچ می‌شود).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import { Ean13Barcode } from "@/components/print/Barcode";

interface PickerVariant { id: string; sku: string; barcode: string | null; price: string; stockQty: number; status: string }
interface PickerProduct {
  id: string; name: string; slug: string; status: string; basePrice: string; costPrice: string | null;
  category: { name: string } | null; brand: { name: string } | null;
  variants: PickerVariant[];
}
/** ردیف لیبل: واریانت + تعداد کپی */
interface LabelRow { key: string; sku: string; barcode: string; productName: string; sizeLabel: string; price: number; copies: number }

/** سایز از SKU — الگوی قاصدک: SKU پایه + بخش سایز در انتها (مثل -75B) */
function sizeFromSku(sku: string): string {
  const tail = sku.split("-").pop() ?? "";
  if (tail && /^\d{2,3}[A-Za-z]*$/.test(tail)) return tail;
  return "";
}

export default function LabelPrintClient() {
  const { call } = useAdminApi();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickerProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LabelRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<"roll" | "a4">("roll");
  const [withPrice, setWithPrice] = useState(true);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (query: string) => {
    setLoading(true); setError(null);
    const r = await call<{ items: PickerProduct[] }>(`/admin/products/picker?q=${encodeURIComponent(query)}&limit=12`);
    setLoading(false);
    if (r.ok && r.data) setItems(r.data.items);
    else setError(r.error?.message ?? "خطا در جستجو");
  }, [call]);

  useEffect(() => {
    void search("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void search(q), 250);
    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const addVariant = (p: PickerProduct, v: PickerVariant) => {
    setError(null);
    if (!v.barcode || !/^\d{13}$/.test(v.barcode)) {
      setError(`واریانت «${v.sku}» بارکد EAN-13 معتبر ندارد (${v.barcode ?? "خالی"}) — بارکد را در محصولات اصلاح کنید.`);
      return;
    }
    setRows((prev) => {
      const key = v.sku;
      const existing = prev.find((r) => r.key === key);
      if (existing) return prev.map((r) => (r.key === key ? { ...r, copies: r.copies + 1 } : r));
      return [...prev, {
        key,
        sku: v.sku,
        barcode: v.barcode!,
        productName: p.name,
        sizeLabel: sizeFromSku(v.sku),
        price: Number(v.price),
        copies: 1,
      }];
    });
  };

  const setCopies = (key: string, copies: number) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, copies: Math.max(1, Math.min(99, copies || 1)) } : r)));

  const removeRow = (key: string) => setRows((prev) => prev.filter((r) => r.key !== key));

  const totalLabels = rows.reduce((a, r) => a + r.copies, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* @page پویا — قالب رول ۵۰×۳۰مم یا A4 (بعد از استایل سراسری می‌آید و بر آن می‌چربد) */}
      <style>{layout === "roll"
        ? "@media print { @page { size: 50mm 30mm; margin: 0; } }"
        : "@media print { @page { size: A4 portrait; margin: 6mm; } }"}</style>
      {/* نوار ابزار — در چاپ پنهان */}
      <div className="print:hidden flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-64">
          <label className="text-xs font-bold text-ink/70">جستجوی کالا (نام / SKU / بارکد — اسکنر هم کار می‌کند)
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="مثلاً سوتین یا DEMO-BRA…"
              className="mt-1 h-10 w-full rounded-xl border border-line bg-surface px-4 text-sm"
              dir="auto"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-ink/70">قالب
            <select value={layout} onChange={(e) => setLayout(e.target.value as "roll" | "a4")} className="mt-1 h-10 rounded-xl border border-line bg-surface px-3 text-sm">
              <option value="roll">رول حرارتی ۵۰×۳۰</option>
              <option value="a4">برگه A4 (۳×۸)</option>
            </select>
          </label>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-line px-3 text-xs font-bold">
            <input type="checkbox" checked={withPrice} onChange={(e) => setWithPrice(e.target.checked)} />
            نمایش قیمت
          </label>
          <button
            onClick={() => window.print()}
            disabled={totalLabels === 0}
            className="h-10 rounded-full bg-primary px-5 text-xs font-black text-on-accent disabled:opacity-50"
          >
            🖨️ چاپ {fa(totalLabels)} برچسب
          </button>
        </div>
      </div>

      {error ? <p className="print:hidden rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      {/* نتایج جستجو — در چاپ پنهان */}
      <div className="print:hidden rounded-card border border-line bg-surface p-4">
        <h3 className="text-sm font-black text-ink">نتایج {loading ? "…" : ""}</h3>
        <div className="mt-3 flex flex-col gap-2">
          {items.map((p) => (
            <div key={p.id} className="rounded-xl border border-line p-3">
              <p className="text-sm font-bold text-ink">{p.name} <span className="text-[11px] font-normal text-muted">{p.brand?.name ? `· ${p.brand.name}` : ""}</span></p>
              <div className="mt-2 flex flex-wrap gap-2">
                {p.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => addVariant(p, v)}
                    title={v.barcode ? `بارکد ${v.barcode}` : "بدون بارکد"}
                    className="rounded-full border border-line px-3 py-1.5 text-[11px] font-bold hover:bg-app-primary-soft"
                  >
                    <span dir="ltr">{v.sku}</span>
                    <span className="text-muted"> · موجودی {fa(v.stockQty)}</span>
                    {v.status !== "PUBLISHED" ? <span className="text-app-warning"> · پیش‌نویس</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {items.length === 0 && !loading ? <p className="text-xs text-muted">نتیجه‌ای نیست.</p> : null}
        </div>
      </div>

      {/* لیبل‌های انتخاب‌شده — پیش‌نمایش + مدیریت تعداد */}
      <div className="print:hidden rounded-card border border-line bg-surface p-4">
        <h3 className="text-sm font-black text-ink">برچسب‌های انتخابی ({fa(rows.length)} واریانت / {fa(totalLabels)} برچسب)</h3>
        {rows.length === 0 ? (
          <p className="mt-2 text-xs text-muted">از نتایج بالا واریانت اضافه کنید. بارکد هر واریانت باید EAN-13 معتبر باشد.</p>
        ) : (
          <div className="admin-table-wrap"><table className="mt-3 w-full text-sm">
            <thead>
              <tr className="border-b border-line text-right text-xs text-ink/60">
                <th className="py-2">کالا</th><th className="py-2">SKU</th><th className="py-2">بارکد</th><th className="py-2">تعداد کپی</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-line/60 last:border-0">
                  <td className="py-2 font-bold">{r.productName}</td>
                  <td className="py-2 text-xs" dir="ltr">{r.sku}</td>
                  <td className="py-2 text-xs" dir="ltr">{r.barcode}</td>
                  <td className="py-2">
                    <input
                      type="number" min={1} max={99} value={r.copies}
                      onChange={(e) => setCopies(r.key, Number(e.target.value))}
                      className="h-8 w-16 rounded-lg border border-line px-2 text-center text-sm tabular-nums"
                    />
                  </td>
                  <td className="py-2 text-left">
                    <button onClick={() => removeRow(r.key)} className="text-xs font-bold text-app-err">حذف</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      {/* ========== ناحیه چاپ — روی صفحه خاکستری پیش‌نمایش، در چاپ واقعی ========== */}
      {rows.length > 0 ? (
        <>
          {/* قالب رول حرارتی ۵۰×۳۰مم — هر لیبل یک صفحه */}
          <div className={layout === "roll" ? "label-print-area label-roll" : "label-print-area hidden-print-area"} aria-hidden={layout !== "roll"}>
            {rows.flatMap((r) =>
              Array.from({ length: r.copies }, (_, i) => (
                <div key={`${r.key}-${i}`} className="label-item label-roll-item">
                  <p className="label-name">{r.productName}{r.sizeLabel ? ` — سایز ${r.sizeLabel}` : ""}</p>
                  <p className="label-sku" dir="ltr">{r.sku}</p>
                  <Ean13Barcode value={r.barcode} height={34} unit={0.9} />
                  {withPrice ? <p className="label-price">{fa(r.price)} تومان</p> : null}
                </div>
              )),
            )}
          </div>

          {/* قالب A4 — شبکه ۳×۸ (لیبل ۶۶×۲۵مم استاندارد) */}
          <div className={layout === "a4" ? "label-print-area label-a4" : "label-print-area hidden-print-area"} aria-hidden={layout !== "a4"}>
            {rows.flatMap((r) =>
              Array.from({ length: r.copies }, (_, i) => (
                <div key={`${r.key}-${i}`} className="label-item label-a4-item">
                  <p className="label-name">{r.productName}{r.sizeLabel ? ` — سایز ${r.sizeLabel}` : ""}</p>
                  <Ean13Barcode value={r.barcode} height={26} unit={0.75} />
                  {withPrice ? <p className="label-price">{fa(r.price)} تومان</p> : null}
                </div>
              )),
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
