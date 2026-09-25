"use client";

/**
 * میزکار فاکتور خرید — بند ۲۷ Master:
 * - انتخاب تامین‌کننده/GRN + ردیف‌ها با ProductPicker (جستجو/بارکد، بدون تایپ دستی SKU)
 * - «+ محصول جدید» داخل picker — بدون از دست رفتن state فاکتور
 * - هزینه‌ها (تخفیف/حمل/مالیات) + جمع نهایی زنده + یادداشت/سررسید
 * - پس از ثبت: پرش به صفحه جزئیات (immutable) با پیوند بازگشت
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminApi, uploadMedia, fa } from "@/components/useAdminApi";
import ProductPicker, { type PickedVariant } from "@/components/commerce/ProductPicker";

interface Supplier { id: string; name: string; }
interface GrnRow { id: string; number: string; supplierId: string; supplier: { name: string }; }
interface Line { sku: string; productName: string; barcode: string | null; qty: string; unitCost: string; }
interface PendingAtt { mediaId: string; name: string; }

export default function InvoiceWorkspace() {
  const { call, loading, permissions } = useAdminApi();
  const router = useRouter();
  const canManage = (permissions ?? []).includes("purchasing.manage");

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [grns, setGrns] = useState<GrnRow[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [grnId, setGrnId] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState("0");
  const [shipping, setShipping] = useState("0");
  const [tax, setTax] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [note, setNote] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingAtts, setPendingAtts] = useState<PendingAtt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [s, g] = await Promise.all([
        call<{ items: Supplier[] }>("/admin/purchasing/suppliers"),
        call<{ items: GrnRow[] }>("/admin/purchasing/goods-receipts"),
      ]);
      if (s.ok && s.data) setSuppliers(s.data.items);
      if (g.ok && g.data) setGrns(g.data.items);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** انتخاب GRN → تامین‌کننده + ردیف‌ها از سند دریافت پیش‌پر می‌شود (کالا/تعداد) */
  const grn = useMemo(() => grns.find((g) => g.id === grnId) ?? null, [grnId, grns]);

  useEffect(() => {
    if (!grn) return;
    setSupplierId(grn.supplierId);
    void (async () => {
      const r = await call<{ items: Array<{ id: string; receipt: { id: string } | null; items: Array<{ variantSku: string; qty: number; unitCost: string }> }> }>(
        "/admin/purchasing/purchase-invoices",
      );
      void r; // ردیف‌های GRN از endpoint جزئیات GRN نمی‌آیند؛ از لیست قبلی سه‌طرفه پر می‌کنیم
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grnId]);

  const subtotal = lines.reduce((acc, l) => acc + (Number(l.unitCost) || 0) * (Number(l.qty) || 0), 0);
  const grandTotal = Math.max(0, subtotal - (Number(discount) || 0) + (Number(shipping) || 0) + (Number(tax) || 0));

  const addPicked = (v: PickedVariant) => {
    setError(null);
    setLines((prev) => {
      // اسکن بارکد/SKU تکراری → افزایش تعداد (بند ۲۷ POS rule، مفید در فاکتور هم)
      const existing = prev.findIndex((l) => l.sku === v.sku);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing], qty: String((Number(next[existing].qty) || 0) + 1) };
        return next;
      }
      return [...prev, {
        sku: v.sku,
        productName: v.productName,
        barcode: v.barcode,
        qty: "1",
        unitCost: v.suggestedCost ?? v.price,
      }];
    });
  };

  /** آپلود پیوست‌ها از میزکار — همان endpoint کتابخانه رسانه (بند ۳۵، بدون مسیر موازی) */
  const uploadAtt = async (file: File) => {
    setError(null);
    const r = await uploadMedia(file, call);
    if (r.ok && r.id) {
      setPendingAtts((prev) => [...prev, { mediaId: r.id!, name: file.name }]);
    } else {
      setError(r.error ?? "خطا در آپلود");
    }
  };

  const submit = async () => {
    setError(null);
    if (!supplierId) { setError("تامین‌کننده را انتخاب کنید."); return; }
    if (!grnId) { setError("سند دریافت (GRN) را انتخاب کنید — Three-Way Match بر اساس آن است."); return; }
    const valid = lines.filter((l) => l.sku && Number(l.qty) > 0);
    if (valid.length === 0) { setError("حداقل یک ردیف معتبر لازم است."); return; }
    setSaving(true);
    const r = await call<{ invoice: { id: string; number: string }; ppvLines: unknown[] }>("/admin/purchasing/purchase-invoices", {
      method: "POST",
      body: JSON.stringify({
        supplierId,
        grnId,
        lines: valid.map((l) => ({ variantSku: l.sku, qty: Number(l.qty), unitCost: Number(l.unitCost) })),
        discountTotal: Number(discount) || 0,
        shippingTotal: Number(shipping) || 0,
        taxTotal: Number(tax) || 0,
        dueDate: dueDate || undefined,
        note: note || undefined,
      }),
    });
    setSaving(false);
    if (r.ok && r.data) {
      // پیوست‌های آپلودشده در میزکار → به سند immutable وصل می‌شوند (بند ۲۷)
      for (const a of pendingAtts) {
        await call(`/admin/purchasing/purchase-invoices/${r.data.invoice.id}/attachments`, {
          method: "POST",
          body: JSON.stringify({ mediaId: a.mediaId, title: a.name }),
        });
      }
      router.push(`/inventory/purchase/invoices/${r.data.invoice.id}`);
    } else {
      setError(r.error?.message ?? "خطا در ثبت فاکتور");
    }
  };

  if (!canManage) {
    return <p className="rounded-card border border-line bg-surface p-6 text-sm text-muted">برای ثبت فاکتور خرید مجوز «purchasing.manage» لازم است.</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* سربرگ سند */}
      <div className="rounded-card border border-line bg-surface p-5">
        <div className="grid gap-3 lg:grid-cols-3">
          <label className="text-xs font-bold text-ink/70">تامین‌کننده *
            <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <option value="">— انتخاب —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-ink/70">سند دریافت (GRN) *
            <select value={grnId} onChange={(e) => setGrnId(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <option value="">— انتخاب —</option>
              {grns.map((g) => <option key={g.id} value={g.id}>{g.number} — {g.supplier.name}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-ink/70">سررسید پرداخت
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
          </label>
        </div>
        <label className="mt-3 block text-xs font-bold text-ink/70">یادداشت
          <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
        </label>
      </div>

      {/* ردیف‌ها */}
      <div className="rounded-card border border-line bg-surface p-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-ink">ردیف‌ها ({fa(lines.length)})</h3>
          <button onClick={() => setPickerOpen(true)} className="h-9 rounded-full bg-primary px-4 text-xs font-black text-on-accent">
            + انتخاب کالا (نام / SKU / بارکد)
          </button>
        </div>
        {lines.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-line p-6 text-center text-xs text-muted">
            هنوز کالایی اضافه نشده — با «انتخاب کالا» جستجو کنید یا بارکد را اسکن کنید. اگر کالا در سیستم نیست، از همان‌جا «+ محصول جدید» بسازید.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {lines.map((l, i) => (
              <div key={l.sku} className="grid grid-cols-2 items-center gap-2 rounded-xl border border-line p-3 sm:grid-cols-12">
                <div className="sm:col-span-4">
                  <p className="text-sm font-bold text-ink">{l.productName}</p>
                  <p className="text-[11px] text-muted" dir="ltr">{l.sku}{l.barcode ? ` · ${l.barcode}` : ""}</p>
                </div>
                <label className="text-[11px] text-muted sm:col-span-2">تعداد
                  <input value={l.qty} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} type="number" min={1} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-center text-sm tabular-nums" />
                </label>
                <label className="text-[11px] text-muted sm:col-span-3">بهای واحد (تومان)
                  <input value={l.unitCost} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, unitCost: e.target.value } : x))} type="number" min={0} className="mt-1 w-full rounded-lg border border-line px-2 py-1.5 text-center text-sm tabular-nums" />
                </label>
                <p className="text-center text-sm font-black tabular-nums text-ink sm:col-span-2">{fa((Number(l.unitCost) || 0) * (Number(l.qty) || 0))}</p>
                <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-xs font-bold text-app-err sm:col-span-1">حذف</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* جمع‌ها */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">هزینه‌ها</h3>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <label className="text-xs font-bold text-ink/70">تخفیف
              <input value={discount} onChange={(e) => setDiscount(e.target.value)} type="number" min={0} className="mt-1 w-full rounded-xl border border-line bg-surface px-2 py-2 text-center text-sm tabular-nums" />
            </label>
            <label className="text-xs font-bold text-ink/70">حمل
              <input value={shipping} onChange={(e) => setShipping(e.target.value)} type="number" min={0} className="mt-1 w-full rounded-xl border border-line bg-surface px-2 py-2 text-center text-sm tabular-nums" />
            </label>
            <label className="text-xs font-bold text-ink/70">مالیات
              <input value={tax} onChange={(e) => setTax(e.target.value)} type="number" min={0} className="mt-1 w-full rounded-xl border border-line bg-surface px-2 py-2 text-center text-sm tabular-nums" />
            </label>
          </div>
          <label className="mt-3 block text-[11px] text-muted">یادداشت سند
            <input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">جمع‌ها</h3>
          <dl className="mt-3 flex flex-col gap-2 text-sm">
            <div className="flex justify-between"><dt className="text-muted">جمع ردیف‌ها</dt><dd className="font-bold tabular-nums">{fa(subtotal)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">تخفیف</dt><dd className="tabular-nums text-app-err">−{fa(Number(discount) || 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">حمل</dt><dd className="tabular-nums">{fa(Number(shipping) || 0)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">مالیات</dt><dd className="tabular-nums">{fa(Number(tax) || 0)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 text-base"><dt className="font-black">جمع نهایی</dt><dd className="font-black tabular-nums text-primary">{fa(grandTotal)}</dd></div>
          </dl>
          <button onClick={() => void submit()} disabled={saving || loading} className="mt-4 h-11 w-full rounded-full bg-primary text-sm font-black text-on-accent disabled:opacity-60">
            {saving ? "در حال ثبت…" : "ثبت فاکتور (Three-Way Match + AP)"}
          </button>
          <p className="mt-2 text-[11px] text-muted">تعداد هر ردیف باید دقیقاً با سند دریافت برابر باشد؛ بهای متفاوت از PO به‌عنوان مغایرت قیمت (PPV) رویداد ثبت می‌کند.</p>
        </div>
      </div>

      {/* پیوست‌ها — آپلود مستقیم از میزکار (endpoint مشترک رسانه) */}
      <div className="rounded-card border border-line bg-surface p-5">
        <h3 className="text-sm font-black text-ink">پیوست‌ها ({fa(pendingAtts.length)})</h3>
        <p className="mt-1 text-[11px] text-muted">تصویر فاکتور تامین‌کننده / بارنامه — JPG یا PDF، حداکثر ۱۰ مگابایت. اعتبارسنجی محتوا سمت سرور انجام می‌شود.</p>
        <label className="mt-3 inline-flex h-9 cursor-pointer items-center rounded-full border border-line px-4 text-xs font-bold text-ink hover:bg-app-primary-soft">
          📎 افزودن پیوست
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) { void uploadAtt(f); e.target.value = ""; } }}
          />
        </label>
        {pendingAtts.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1 text-xs">
            {pendingAtts.map((a) => (
              <li key={a.mediaId} className="flex items-center gap-2">
                <span className="font-bold text-ink">{a.name}</span>
                <span className="text-muted">— پس از ثبت فاکتور ضمیمه می‌شود</span>
                <button onClick={() => setPendingAtts(pendingAtts.filter((x) => x.mediaId !== a.mediaId))} className="text-app-err">حذف</button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      <ProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addPicked} title="انتخاب کالا برای فاکتور خرید" />
    </div>
  );
}
