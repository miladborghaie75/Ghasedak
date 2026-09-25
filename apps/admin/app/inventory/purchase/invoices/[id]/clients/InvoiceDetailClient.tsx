"use client";

/**
 * جزئیات فاکتور خرید — بند ۲۷ Master (صفحه حرفه‌ای):
 * - snapshot تامین‌کننده، متادیتا، ردیف‌ها با مغایرت بها (فاکتور vs GRN)
 * - پرداخت‌ها + مانده + وضعیت AP، اثر انبار (GRN)، اسناد حسابداری
 * - audit trail، پیوست‌ها، چاپ (print-friendly)، لینک بازگشت
 * همه از منابع حقیقت: /admin/purchasing/purchase-invoices/:id/detail
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface Detail {
  invoice: { id: string; number: string; state: string; dueDate: string | null; note: string | null; createdAt: string; subtotal: string; discountTotal: string; shippingTotal: string; taxTotal: string; grandTotal: string };
  supplier: { id: string; name: string; phone: string | null; taxId: string | null; address: string | null };
  receipt: { id: string; number: string; receivedAt: string; warehouse: { code: string; name: string }; poNumber: string | null } | null;
  lines: Array<{ id: string; variantSku: string; qty: number; unitCost: string; lineTotal: number; productName: string; barcode: string | null; grnUnitCost: string | null; grnLandedCost: string | null; priceVariance: number | null }>;
  payments: Array<{ id: string; method: string; amount: string; paidAt: string }>;
  totals: { paidTotal: number; balance: number; apAmount: number | null; apState: string | null; apPaid: number | null };
  inventoryImpact: Array<{ sku: string; qty: number; unitCost: string; landedCost: string }>;
  accounting: Array<{ id: string; number: string; date: string; description: string | null; lines: Array<{ code: string; name: string; debit: string; credit: string }> }>;
  attachments: Array<{ id: string; mediaId: string; title: string | null; createdAt: string }>;
  audit: Array<{ id: string; action: string; actorId: string | null; at: string; meta: Record<string, unknown> }>;
}

const STATE_FA: Record<string, string> = {
  DRAFT: "پیش‌نویس", POSTED: "ثبت‌شده", PAID: "تسویه‌شده", PARTIALLY_PAID: "تسویه جزئی", CANCELLED: "لغو",
  SETTLED: "تسویه", PARTIAL: "تسویه جزئی", OPEN: "باز",
};
const METHOD_FA: Record<string, string> = { cash: "نقدی", card: "کارت", transfer: "انتقال/کارت‌به‌کارت", check: "چک" };

export default function InvoiceDetailClient() {
  const { call, permissions } = useAdminApi();
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState("transfer");
  const canPay = (permissions ?? []).includes("purchasing.pay");
  const canManage = (permissions ?? []).includes("purchasing.manage");

  const load = async () => {
    if (!id) return;
    const r = await call<Detail>(`/admin/purchasing/purchase-invoices/${id}/detail`);
    if (r.ok && r.data) setData(r.data);
    else setError(r.error?.message ?? "خطا در بارگذاری");
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const pay = async () => {
    setError(null); setMsg(null);
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { setError("مبلغ پرداخت را وارد کنید."); return; }
    const r = await call(`/admin/purchasing/purchase-invoices/${id}/pay`, { method: "POST", body: JSON.stringify({ amount, method: payMethod }) });
    if (r.ok) { setMsg("پرداخت ثبت شد ✅"); setPayAmount(""); await load(); }
    else setError(r.error?.message ?? "خطا در پرداخت");
  };

  if (error && !data) return <p className="rounded-card border border-line bg-surface p-6 text-sm text-app-err">{error}</p>;
  if (!data) return <p className="rounded-card border border-line bg-surface p-6 text-sm text-muted">در حال بارگذاری…</p>;

  const { invoice, supplier, receipt, lines, payments, totals, inventoryImpact, accounting, attachments, audit } = data;

  return (
    <div className="flex flex-col gap-5">
      {/* نوار اقدام — در چاپ پنهان */}
      <div className="print:hidden flex flex-wrap items-center gap-2">
        <Link href="/inventory/purchase" className="rounded-full border border-line px-4 py-2 text-xs font-bold">→ بازگشت به خرید</Link>
        <button onClick={() => window.print()} className="rounded-full bg-ink px-4 py-2 text-xs font-black text-on-accent">🖨️ چاپ فاکتور</button>
        {invoice.state === "POSTED" ? <span className="rounded-full bg-app-ok-soft px-3 py-1.5 text-[11px] font-bold text-app-ok">سند immutable — اصلاح فقط با برگشت/اعتبار</span> : null}
      </div>
      {msg ? <p className="print:hidden rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
      {error ? <p className="print:hidden rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      {/* سربرگ سند */}
      <section className="rounded-card border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-black text-ink">فاکتور خرید <span dir="ltr">{invoice.number}</span></h2>
            <p className="mt-1 text-xs text-muted">تاریخ ثبت: {new Date(invoice.createdAt).toLocaleDateString("fa-IR")}{invoice.dueDate ? ` · سررسید: ${new Date(invoice.dueDate).toLocaleDateString("fa-IR")}` : ""}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-black ${invoice.state === "PAID" ? "bg-app-ok-soft text-app-ok" : invoice.state === "POSTED" ? "bg-primary-soft text-primary" : "bg-app-warning-soft text-app-warning"}`}>
            {STATE_FA[invoice.state] ?? invoice.state}
          </span>
        </div>
        <div className="mt-4 grid gap-3 text-sm lg:grid-cols-3">
          <div className="rounded-xl border border-line p-3">
            <h3 className="text-[11px] font-black text-muted">تامین‌کننده (snapshot)</h3>
            <p className="mt-1 font-bold">{supplier.name}</p>
            <p className="text-xs text-muted" dir="ltr">{supplier.phone ?? "—"}</p>
            <p className="text-xs text-muted" dir="ltr">{supplier.taxId ? `شناسه مالیاتی: ${supplier.taxId}` : ""}</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <h3 className="text-[11px] font-black text-muted">سند دریافت / PO</h3>
            <p className="mt-1 font-bold" dir="ltr">{receipt?.number ?? "—"}</p>
            <p className="text-xs text-muted">{receipt ? `${receipt.warehouse.name} · ${new Date(receipt.receivedAt).toLocaleDateString("fa-IR")}` : "بدون GRN"}</p>
            <p className="text-xs text-muted" dir="ltr">{receipt?.poNumber ? `PO: ${receipt.poNumber}` : ""}</p>
          </div>
          <div className="rounded-xl border border-line p-3">
            <h3 className="text-[11px] font-black text-muted">حساب پرداختنی (AP)</h3>
            <p className="mt-1 font-bold tabular-nums">{totals.apAmount != null ? fa(totals.apAmount) : "—"}</p>
            <p className="text-xs text-muted">{totals.apState ? STATE_FA[totals.apState] ?? totals.apState : "—"} · پرداخت‌شده: {fa(totals.apPaid ?? 0)}</p>
          </div>
        </div>
        {invoice.note ? <p className="mt-3 rounded-xl bg-app-primary-soft px-3 py-2 text-xs text-ink/80">یادداشت: {invoice.note}</p> : null}
      </section>

      {/* ردیف‌ها */}
      <section className="overflow-hidden rounded-card border border-line bg-surface">
        <h3 className="border-b border-line p-4 text-sm font-black text-ink">ردیف‌ها ({fa(lines.length)})</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-2">کالا</th><th className="px-4 py-2">SKU/بارکد</th>
              <th className="px-4 py-2">تعداد</th><th className="px-4 py-2">بهای واحد</th>
              <th className="px-4 py-2">بهای GRN</th><th className="px-4 py-2">مغایرت</th><th className="px-4 py-2">جمع ردیف</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-2 font-bold">{l.productName}</td>
                <td className="px-4 py-2 text-[11px]" dir="ltr">{l.variantSku}{l.barcode ? ` · ${l.barcode}` : ""}</td>
                <td className="px-4 py-2 tabular-nums">{fa(l.qty)}</td>
                <td className="px-4 py-2 tabular-nums">{fa(l.unitCost)}</td>
                <td className="px-4 py-2 tabular-nums text-ink/60">{l.grnUnitCost != null ? fa(l.grnUnitCost) : "—"}</td>
                <td className={`px-4 py-2 tabular-nums text-xs font-bold ${l.priceVariance ? (l.priceVariance > 0 ? "text-app-err" : "text-app-ok") : ""}`}>
                  {l.priceVariance ? `${l.priceVariance > 0 ? "+" : ""}${fa(l.priceVariance)}` : "—"}
                </td>
                <td className="px-4 py-2 font-black tabular-nums">{fa(l.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex flex-col gap-1 p-4 text-sm">
          <div className="flex justify-between"><span className="text-muted">جمع ردیف‌ها</span><span className="font-bold tabular-nums">{fa(invoice.subtotal)}</span></div>
          {Number(invoice.discountTotal) > 0 ? <div className="flex justify-between"><span className="text-muted">تخفیف</span><span className="tabular-nums text-app-err">−{fa(invoice.discountTotal)}</span></div> : null}
          <div className="flex justify-between"><span className="text-muted">حمل</span><span className="tabular-nums">{fa(invoice.shippingTotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted">مالیات</span><span className="tabular-nums">{fa(invoice.taxTotal)}</span></div>
          <div className="flex justify-between border-t border-line pt-2 text-base"><span className="font-black">جمع کل</span><span className="font-black tabular-nums text-primary">{fa(invoice.grandTotal)}</span></div>
          <div className="flex justify-between"><span className="text-muted">پرداخت‌شده</span><span className="tabular-nums text-app-ok">{fa(totals.paidTotal)}</span></div>
          <div className="flex justify-between text-base"><span className="font-black">مانده</span><span className={`font-black tabular-nums ${totals.balance > 0 ? "text-app-warning" : "text-app-ok"}`}>{fa(totals.balance)}</span></div>
        </div>
      </section>

      {/* پرداخت‌ها + فرم پرداخت */}
      <section className="rounded-card border border-line bg-surface p-5 print:hidden">
        <h3 className="text-sm font-black text-ink">پرداخت‌ها ({fa(payments.length)})</h3>
        {payments.length > 0 ? (
          <table className="mt-3 w-full text-sm">
            <thead><tr className="border-b border-line text-right text-xs text-ink/60"><th className="py-2">مبلغ</th><th className="py-2">روش</th><th className="py-2">تاریخ</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-line/60 last:border-0">
                  <td className="py-2 tabular-nums">{fa(p.amount)}</td>
                  <td className="py-2 text-xs">{METHOD_FA[p.method] ?? p.method}</td>
                  <td className="py-2 text-xs">{new Date(p.paidAt).toLocaleDateString("fa-IR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="mt-2 text-xs text-muted">پرداختی ثبت نشده است.</p>}
        {canPay && totals.balance > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input value={payAmount} onChange={(e) => setPayAmount(e.target.value)} type="number" min={1} placeholder={`مانده: ${fa(totals.balance)}`} className="h-9 w-40 rounded-lg border border-line px-2 text-center text-sm tabular-nums" />
            <select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} className="h-9 rounded-lg border border-line px-2 text-xs">
              <option value="transfer">انتقال/کارت‌به‌کارت</option>
              <option value="cash">نقدی</option>
              <option value="card">کارت</option>
              <option value="check">چک</option>
            </select>
            <button onClick={() => void pay()} className="h-9 rounded-full bg-primary px-4 text-xs font-black text-on-accent">ثبت پرداخت</button>
          </div>
        ) : null}
      </section>

      {/* اثر انبار + حسابداری */}
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">اثر انبار (GRN → Ledger + WAC)</h3>
          <table className="mt-3 w-full text-xs">
            <thead><tr className="border-b border-line text-right text-ink/60"><th className="py-2">SKU</th><th className="py-2">تعداد</th><th className="py-2">بها</th><th className="py-2">سربه‌دار</th></tr></thead>
            <tbody>
              {inventoryImpact.map((i) => (
                <tr key={i.sku} className="border-b border-line/60 last:border-0">
                  <td className="py-2" dir="ltr">{i.sku}</td>
                  <td className="py-2 tabular-nums">+{fa(i.qty)}</td>
                  <td className="py-2 tabular-nums">{fa(i.unitCost)}</td>
                  <td className="py-2 tabular-nums">{fa(i.landedCost)}</td>
                </tr>
              ))}
              {inventoryImpact.length === 0 ? <tr><td colSpan={4} className="py-3 text-center text-muted">بدون اثر انبار</td></tr> : null}
            </tbody>
          </table>
        </section>
        <section className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">اسناد حسابداری</h3>
          {accounting.length > 0 ? accounting.map((j) => (
            <div key={j.id} className="mt-3 rounded-xl border border-line p-3">
              <p className="text-xs font-bold" dir="ltr">{j.number}</p>
              <p className="text-[11px] text-muted">{j.description ?? ""} · {new Date(j.date).toLocaleDateString("fa-IR")}</p>
              <table className="mt-2 w-full text-[11px]">
                <tbody>
                  {j.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="py-0.5" dir="ltr">{l.code} {l.name}</td>
                      <td className="py-0.5 tabular-nums">{Number(l.debit) > 0 ? `بدهکار ${fa(l.debit)}` : `بستانکار ${fa(l.credit)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )) : <p className="mt-2 text-xs text-muted">سند حسابداری ثبت نشده.</p>}
        </section>
      </div>

      {/* پیوست‌ها + audit */}
      <div className="grid gap-4 lg:grid-cols-2 print:hidden">
        <section className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">پیوست‌ها ({fa(attachments.length)})</h3>
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {attachments.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <a href={`/api/media/${a.mediaId}`} target="_blank" rel="noopener noreferrer" className="font-bold text-primary hover:underline">{a.title ?? "پیوست"}</a>
                <span className="text-muted">{new Date(a.createdAt).toLocaleDateString("fa-IR")}</span>
              </li>
            ))}
            {attachments.length === 0 ? <li className="text-muted">پیوستی ثبت نشده.</li> : null}
          </ul>
        </section>
        <section className="rounded-card border border-line bg-surface p-5">
          <h3 className="text-sm font-black text-ink">ردپای حسابرسی</h3>
          <ul className="mt-2 flex flex-col gap-1.5 text-xs">
            {audit.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="font-bold" dir="ltr">{a.action}</span>
                <span className="text-muted">{new Date(a.at).toLocaleString("fa-IR")}</span>
              </li>
            ))}
            {audit.length === 0 ? <li className="text-muted">رکورد حسابرسی یافت نشد.</li> : null}
          </ul>
        </section>
      </div>
    </div>
  );
}
