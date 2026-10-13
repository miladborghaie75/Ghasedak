"use client";

/**
 * سفارش‌ها — بند ۶ فاز ۱۴: ویرایش حرفه‌ای سفارش پرداخت‌نشده + تاریخچهٔ بازبینی.
 * - دیالوگ ویرایش: خطوط (تعداد/حذف/افزودن با ProductPicker)، آدرس، روش ارسال
 * - جمع زنده از پاسخ سرور (محاسبهٔ دوباره سرور-محور)
 * - تاریخچه: GET /orders/:id/revisions (ORDER_EDITED با diff قبل/بعد)
 */
import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import ProductPicker, { type PickedVariant } from "@/components/commerce/ProductPicker";
import ShipmentPanel from "./ShipmentPanel";

interface OrderRow {
  id: string; code: string; status: string; paymentStatus: string;
  trackingCode?: string | null;
  shipments?: Array<{ id: string; status: string; trackingCode: string | null; provider: string | null; shippedAt: string | null; deliveredAt: string | null }>;
  total: string; guestName: string | null; guestMobile: string; createdAt: string;
}
interface EditLine { sku: string; productName: string; qty: string; }
interface Revision { id: string; type: string; payload: { reason?: string | null; before?: { total?: number; lines?: Array<{ sku: string; qty: number }> }; after?: { total?: number; lines?: Array<{ sku: string; qty: number }> } } | null; createdAt: string; }

const STATUS_FA: Record<string, string> = {
  PENDING: "در انتظار", CONFIRMED: "تأییدشده", PROCESSING: "در حال پردازش", SHIPPED: "ارسال‌شده", DELIVERED: "تحویل‌شده", CANCELLED: "لغوشده",
};

export default function OrdersClient() {
  const { call, loading, permissions } = useAdminApi();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  // ویرایش
  const [editOrder, setEditOrder] = useState<OrderRow | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // تاریخچه
  const [revOrder, setRevOrder] = useState<OrderRow | null>(null);
  const [revs, setRevs] = useState<Revision[]>([]);
  const [shipOrder, setShipOrder] = useState<OrderRow | null>(null);

  const canEdit = (permissions ?? []).includes("orders.update");

  const load = async () => {
    const r = await call<{ items: OrderRow[] }>("/orders");
    if (r.ok && r.data) setRows(r.data.items);
    else setError(r.error?.message ?? "خطا");
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const openEdit = async (o: OrderRow) => {
    setError(null); setMsg(null);
    const r = await call<{ items?: Array<{ qty: number; titleSnapshot: string; variant?: { sku: string } | null }> }>(`/orders/by-code/${o.code}`);
    if (!r.ok || !r.data) { setError(r.error?.message ?? "خطا در بارگذاری سفارش"); return; }
    const items = r.data.items ?? [];
    setLines(items.map((it) => ({ sku: it.variant?.sku ?? "", productName: it.titleSnapshot, qty: String(it.qty) })));
    setEditOrder(o);
  };

  const addPicked = (v: PickedVariant) => {
    setLines((prev) => {
      const ex = prev.findIndex((l) => l.sku === v.sku);
      if (ex >= 0) { const next = [...prev]; next[ex] = { ...next[ex], qty: String((Number(next[ex].qty) || 0) + 1) }; return next; }
      return [...prev, { sku: v.sku, productName: v.productName, qty: "1" }];
    });
  };

  const submitEdit = async () => {
    if (!editOrder) return;
    setError(null); setMsg(null);
    const valid = lines.filter((l) => l.sku && Number(l.qty) > 0);
    if (valid.length === 0) { setError("حداقل یک ردیف معتبر لازم است."); return; }
    setSaving(true);
    const r = await call<{ code: string; total: string }>(`/orders/${editOrder.id}/edit`, {
      method: "POST",
      body: JSON.stringify({ lines: valid.map((l) => ({ sku: l.sku, qty: Number(l.qty) })), reason: "ویرایش از پنل ادمین" }),
    });
    setSaving(false);
    if (r.ok) { setMsg(`سفارش ${r.data?.code} ویرایش شد — جمع جدید: ${fa(r.data?.total ?? 0)} تومان`); setEditOrder(null); await load(); }
    else setError(r.error?.message ?? "خطا در ویرایش");
  };

  const openRevs = async (o: OrderRow) => {
    setError(null); setMsg(null);
    const r = await call<{ items: Revision[] }>(`/orders/${o.id}/revisions`);
    if (r.ok && r.data) { setRevs(r.data.items); setRevOrder(o); }
    else setError(r.error?.message ?? "خطا");
  };

  const editable = (o: OrderRow) => canEdit && o.paymentStatus !== "PAID" && o.status !== "CANCELLED" && o.status !== "SHIPPED" && o.status !== "DELIVERED";

  return (
    <div className="flex flex-col gap-4">
      {msg ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <div className="admin-table-wrap"><table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">شماره</th><th className="px-4 py-3">مشتری</th><th className="px-4 py-3">موبایل</th>
              <th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">پرداخت</th><th className="px-4 py-3">مبلغ</th><th className="px-4 py-3">تاریخ</th><th className="px-4 py-3">اقدام</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-ink/50">هنوز سفارشی ثبت نشده است.</td></tr>
            ) : rows.map((o) => (
              <tr key={o.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-bold" dir="ltr">{o.code}</td>
                <td className="px-4 py-3">{o.guestName ?? "مهمان"}</td>
                <td className="px-4 py-3 tabular-nums" dir="ltr">{o.guestMobile}</td>
                <td className="px-4 py-3">{STATUS_FA[o.status] ?? o.status}
                  {/* کد رهگیری پستی — همان چیزی که مشتری می‌بیند */}
                  {o.trackingCode ? (
                    <p className="mt-1 text-[10px] font-bold text-primary-strong" dir="ltr">{o.trackingCode}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <span className={o.paymentStatus === "PAID" ? "font-bold text-app-ok" : "font-bold text-app-warning"}>
                    {o.paymentStatus === "PAID" ? "پرداخت‌شده" : o.paymentStatus === "PENDING" ? "در انتظار" : o.paymentStatus}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums">{fa(o.total)}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{new Date(o.createdAt).toLocaleDateString("fa-IR")}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {editable(o) ? (
                      <button onClick={() => void openEdit(o)} className="rounded-full bg-primary px-3 py-1 text-xs font-black text-on-accent">ویرایش</button>
                    ) : null}
                    {o.paymentStatus === "PAID" ? (
                      <button
                        onClick={() => setShipOrder(o)}
                        className="rounded-full border border-line px-3 py-1 text-xs font-bold"
                        title="ساخت مرسوله و ثبت کد رهگیری پستی"
                      >
                        ارسال
                      </button>
                    ) : null}
                    <button onClick={() => void openRevs(o)} className="rounded-full border border-line px-3 py-1 text-xs font-bold">تاریخچه</button>
                    {/* چاپ فاکتور فروش — فقط سفارش پرداخت‌شده فاکتور معتبر دارد */}
                    {o.paymentStatus === "PAID" ? (
                      <a
                        href={`/orders/invoice-print/${encodeURIComponent(o.code)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full border border-line px-3 py-1 text-xs font-bold"
                        title="چاپ فاکتور فروش / ذخیره PDF"
                      >
                        چاپ فاکتور
                      </a>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {/* دیالوگ ویرایش */}
      {editOrder ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" onClick={() => setEditOrder(null)}>
          <div className="mt-8 w-full max-w-2xl overflow-hidden rounded-card border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line p-4">
              <h2 className="text-sm font-black text-ink">ویرایش سفارش <span dir="ltr">{editOrder.code}</span></h2>
              <p className="text-[11px] text-muted">پرداخت‌نشده — قیمت‌ها هنگام ثبت از سرور دوباره محاسبه می‌شوند</p>
              <button onClick={() => setEditOrder(null)} aria-label="بستن" className="ms-auto h-8 w-8 rounded-full border border-line text-xs font-bold">✕</button>
            </div>
            <div className="max-h-[55vh] overflow-y-auto p-4">
              {lines.map((l, i) => (
                <div key={`${l.sku}-${i}`} className="mb-2 flex items-center gap-2 rounded-xl border border-line p-2">
                  <div className="flex-1">
                    <p className="text-sm font-bold text-ink">{l.productName}</p>
                    <p className="text-[11px] text-muted" dir="ltr">{l.sku}</p>
                  </div>
                  <input value={l.qty} onChange={(e) => setLines(lines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} type="number" min={1} max={99} className="h-8 w-16 rounded-lg border border-line px-2 text-center text-sm tabular-nums" />
                  <button onClick={() => setLines(lines.filter((_, j) => j !== i))} className="text-xs font-bold text-app-err">حذف</button>
                </div>
              ))}
              <button onClick={() => setPickerOpen(true)} className="h-9 rounded-full bg-primary px-4 text-xs font-black text-on-accent">+ افزودن کالا</button>
              <p className="mt-3 rounded-xl bg-app-warning-soft px-3 py-2 text-[11px] text-ink/80">توجه: کد تخفیف قبلی با ویرایش باطل و قیمت‌گذاری تازه می‌شود؛ موجودی هنگام ثبت اعتبارسنجی می‌شود.</p>
            </div>
            <div className="flex gap-2 border-t border-line p-4">
              <button onClick={() => void submitEdit()} disabled={saving || loading} className="h-10 rounded-full bg-primary px-5 text-sm font-black text-on-accent disabled:opacity-60">
                {saving ? "در حال ثبت…" : "ثبت ویرایش"}
              </button>
              <button onClick={() => setEditOrder(null)} className="h-10 rounded-full border border-line px-5 text-sm font-bold">انصراف</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* دیالوگ تاریخچه */}
      {revOrder ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8" role="dialog" aria-modal="true" onClick={() => setRevOrder(null)}>
          <div className="mt-8 w-full max-w-2xl overflow-hidden rounded-card border border-line bg-surface shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line p-4">
              <h2 className="text-sm font-black text-ink">تاریخچهٔ بازبینی <span dir="ltr">{revOrder.code}</span></h2>
              <button onClick={() => setRevOrder(null)} aria-label="بستن" className="ms-auto h-8 w-8 rounded-full border border-line text-xs font-bold">✕</button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {revs.length === 0 ? <p className="p-4 text-center text-xs text-muted">بازبینی‌ای ثبت نشده است.</p> : null}
              {revs.map((rv) => (
                <div key={rv.id} className="mb-3 rounded-xl border border-line p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-black text-ink">{rv.type === "ORDER_EDITED" ? "ویرایش سفارش" : rv.type}</span>
                    <span className="text-[11px] text-muted">{new Date(rv.createdAt).toLocaleString("fa-IR")}</span>
                  </div>
                  {rv.payload?.reason ? <p className="mt-1 text-[11px] text-muted">دلیل: {rv.payload.reason}</p> : null}
                  {rv.payload?.before && rv.payload?.after ? (
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                      <div className="rounded-lg bg-app-primary-soft p-2">
                        <p className="font-black text-muted">قبل</p>
                        <p>جمع: {fa(rv.payload.before.total ?? 0)}</p>
                        <p>{(rv.payload.before.lines ?? []).map((l) => `${l.sku}×${l.qty}`).join(" ، ")}</p>
                      </div>
                      <div className="rounded-lg bg-app-ok-soft p-2">
                        <p className="font-black text-muted">بعد</p>
                        <p>جمع: {fa(rv.payload.after.total ?? 0)}</p>
                        <p>{(rv.payload.after.lines ?? []).map((l) => `${l.sku}×${l.qty}`).join(" ، ")}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {shipOrder ? (
        <ShipmentPanel
          orderId={shipOrder.id}
          orderCode={shipOrder.code}
          paid={shipOrder.paymentStatus === "PAID"}
          onClose={() => setShipOrder(null)}
        />
      ) : null}

      <ProductPicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addPicked} title="افزودن کالا به سفارش" />
    </div>
  );
}
