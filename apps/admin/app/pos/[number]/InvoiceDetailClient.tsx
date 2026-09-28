"use client";

/**
 * فاز ۱۰ — بخش ۵/۶/۹: Invoice Detail از دادهٔ persisted.
 * جورنال + اثر انبار + پرداخت‌ها/چک + اصلاحیهٔ کنترل‌شده + چاپ ۸۰mm/A4 از منبع حقیقت.
 */

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import { buildReceiptHtml, buildA4Html } from "../receipt";

interface Detail {
  invoice: {
    id: string; number: string; state: string; subtotal: string; discountTotal: string; grandTotal: string;
    customerName: string | null; customerMobile: string | null; createdAt: string; finalizedAt: string | null;
    revision: number; correctsId: string | null;
    items: Array<{ id: string; variantSku: string; qty: number; unitPriceSnapshot: string; lineTotal: string; variant?: { product?: { name: string } } }>;
    payments: Array<{ id: string; method: string; amount: string; check?: { number: string; bankName: string; dueDate: string; status: string } | null }>;
    cashier?: { name: string | null } | null;
    shift?: { id: string; openedAt: string; register?: { name: string } | null } | null;
  };
  customer: { id: string; name: string | null; mobile: string | null } | null;
  journal: { number: string; lines: Array<{ account: { code: string; name: string }; debit: string; credit: string }> } | null;
  ledgerMoves: Array<{ id: string; variantSku: string; type: string; qtyIn: number; qtyOut: number }>;
  corrections: Array<{ id: string; number: string; revision: number; createdAt: string }>;
}

const METHOD_FA: Record<string, string> = { CASH: "نقدی", CARD: "کارت", ONLINE: "آنلاین", BANK_TRANSFER: "کارت به کارت", CHECK: "چک", CREDIT: "اعتباری", WALLET: "کیف پول" };

export default function InvoiceDetailClient({ invoiceNumber }: { invoiceNumber: string }) {
  const { call, loading } = useAdminApi();
  const [data, setData] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showCorrect, setShowCorrect] = useState(false);

  const load = async () => {
    const r = await call<Detail>(`/pos/invoices/by-number/${encodeURIComponent(invoiceNumber)}`);
    if (r.ok && r.data) setData({ ...r.data, journal: r.data.journal ?? null } as Detail);
    else setError(r.error?.message ?? "فاکتور یافت نشد.");
  };

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const print = (format: "80mm" | "A4") => {
    if (!data) return;
    const inv = data.invoice;
    const d = {
      storeName: "لباس زیر قاصدک",
      number: inv.number,
      createdAt: inv.createdAt,
      items: inv.items.map((i) => ({ name: i.variant?.product?.name ?? i.variantSku, qty: i.qty, unitPrice: Number(i.unitPriceSnapshot), lineTotal: Number(i.lineTotal) })),
      discount: Number(inv.discountTotal),
      total: Number(inv.grandTotal),
      payments: inv.payments.map((p) => ({ method: METHOD_FA[p.method] ?? p.method, amount: Number(p.amount) })),
      customer: inv.customerName ?? inv.customerMobile ?? null,
    };
    const w = window.open("", "print", format === "80mm" ? "width=380,height=600" : "width=900,height=900");
    if (!w) { setError("popup چاپ مسدود است."); return; }
    w.document.write(format === "80mm" ? buildReceiptHtml(d) : buildA4Html(d));
    w.document.close();
  };

  const submitCorrection = async () => {
    if (!data) return;
    setError(null); setMsg(null);
    const r = await call<{ number: string }>(`/pos/invoices/by-id/${data.invoice.id}/correct`, {
      method: "POST",
      body: JSON.stringify({
        shiftId: data.invoice.shift?.id,
        lines: data.invoice.items.map((i) => ({ sku: i.variantSku, qty: i.qty })),
        payments: data.invoice.payments.map((p) => ({ methodCode: p.method.toLowerCase(), amount: Number(p.amount), checkNumber: "—", bankName: "—", dueDateDays: 0 })),
        reason,
      }),
    });
    if (r.ok) { setMsg(`اصلاحیهٔ ${r.data?.number} ثبت شد — این نسخه trace باقی می‌ماند.`); setShowCorrect(false); }
    else setError(r.error?.message ?? "خطا در اصلاحیه");
  };

  if (error && !data) return <p className="rounded-xl bg-app-primary-soft p-4 text-sm font-bold text-app-err">{error}</p>;
  if (!data) return <p className="p-6 text-sm text-ink/50">در حال بارگذاری…</p>;

  const inv = data.invoice;
  return (
    <div className="space-y-4">
      {msg ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-4">
        <div>
          <p className="text-xs text-ink/50">فاکتور</p>
          <p className="text-lg font-black" dir="ltr">{inv.number}{inv.revision > 1 ? ` (rev ${fa(inv.revision)})` : ""}</p>
        </div>
        <div className="text-xs text-ink/60">
          <p>{new Date(inv.createdAt).toLocaleString("fa-IR")}</p>
          <p>صندوق: {inv.shift?.register?.name ?? "—"} — کاشیر: {inv.cashier?.name ?? "—"}</p>
          <p>مشتری: {data.customer?.name ?? inv.customerName ?? "—"}</p>
        </div>
        <div className="ms-auto text-end">
          <p className="text-2xl font-black tabular-nums">{fa(inv.grandTotal)}</p>
          <p className="text-xs font-bold text-app-ok">{inv.state}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => print("80mm")} className="h-9 rounded-full bg-ink px-4 text-xs font-black text-on-accent">🖨️ چاپ ۸۰mm</button>
        <button onClick={() => print("A4")} className="h-9 rounded-full border border-line px-4 text-xs font-bold">چاپ A4</button>
        <button onClick={() => setShowCorrect((s) => !s)} disabled={inv.state !== "FINALIZED"} className="h-9 rounded-full border border-line px-4 text-xs font-bold disabled:opacity-40">
          ✎ اصلاحیهٔ کنترل‌شده
        </button>
        {data.corrections.length === 0 && inv.correctsId ? (
          <a href={`/pos/${encodeURIComponent(inv.number)}`} className="h-9 rounded-full border border-line px-4 text-xs font-bold leading-9">مشاهده نسخهٔ مبدأ</a>
        ) : null}
      </div>

      {showCorrect ? (
        <div className="rounded-xl border border-line p-4">
          <p className="mb-2 text-xs font-bold text-ink/70">
            اصلاحیه: فاکتور جدید revision+1 می‌سازد؛ سند مبدأ معکوس، انبار مبدأ برگردانده و اقلام دوباره ثبت می‌شود — همه در یک تراکنش با audit. فاکتور FINALIZED هرگز overwrite نمی‌شود.
          </p>
          <div className="flex gap-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="دلیل اصلاح (الزامی)" className="h-9 flex-1 rounded-xl border border-line px-3 text-xs" />
            <button onClick={() => void submitCorrection()} disabled={loading || !reason.trim()} className="h-9 rounded-xl bg-primary px-4 text-xs font-black text-on-accent disabled:opacity-50">ثبت اصلاحیه</button>
          </div>
        </div>
      ) : null}

      <section className="rounded-xl border border-line">
        <h3 className="border-b border-line px-4 py-2 text-xs font-black">اقلام</h3>
        <table className="w-full text-xs">
          <thead><tr className="border-b border-line text-ink/50"><th className="p-2 text-right">کالا</th><th>SKU</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.id} className="border-b border-line/50 last:border-0">
                <td className="p-2 text-right font-bold">{i.variant?.product?.name ?? "—"}</td>
                <td className="text-center text-ink/40" dir="ltr">{i.variantSku}</td>
                <td className="text-center tabular-nums">{fa(i.qty)}</td>
                <td className="text-center tabular-nums">{fa(i.unitPriceSnapshot)}</td>
                <td className="text-center tabular-nums">{fa(i.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line p-4">
          <h3 className="mb-2 text-xs font-black">پرداخت‌ها</h3>
          <ul className="space-y-1.5 text-xs">
            {inv.payments.map((p) => (
              <li key={p.id} className="flex justify-between">
                <span className="font-bold">{METHOD_FA[p.method] ?? p.method}</span>
                <span className="tabular-nums">{fa(p.amount)}</span>
              </li>
            ))}
            {inv.payments.filter((p) => p.check).map((p) => (
              <li key={`chk-${p.id}`} className="rounded-lg bg-primary-tint px-2 py-1.5 text-[11px]">
                چک {p.check!.number} — {p.check!.bankName} — سررسید {new Date(p.check!.dueDate).toLocaleDateString("fa-IR")} — {p.check!.status}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-line p-4">
          <h3 className="mb-2 text-xs font-black">سند حسابداری</h3>
          {data.journal ? (
            <>
              <p className="mb-1 text-[11px] text-ink/50" dir="ltr">{data.journal.number}</p>
              <ul className="space-y-1 text-[11px]">
                {data.journal.lines.map((l, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{l.account.code} — {l.account.name}</span>
                    <span className="tabular-nums">{Number(l.debit) > 0 ? `Dr ${fa(l.debit)}` : `Cr ${fa(l.credit)}`}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="text-xs text-ink/40">سندی یافت نشد.</p>}
        </section>

        <section className="rounded-xl border border-line p-4">
          <h3 className="mb-2 text-xs font-black">اثر انبار</h3>
          <ul className="space-y-1 text-[11px]">
            {data.ledgerMoves.map((m) => (
              <li key={m.id} className="flex justify-between">
                <span dir="ltr">{m.variantSku}</span>
                <span className="tabular-nums">{m.type} {m.qtyIn > 0 ? `+${fa(m.qtyIn)}` : `−${fa(m.qtyOut)}`}</span>
              </li>
            ))}
            {data.ledgerMoves.length === 0 ? <li className="text-ink/40">حرکتی ثبت نشده.</li> : null}
          </ul>
        </section>

        <section className="rounded-xl border border-line p-4">
          <h3 className="mb-2 text-xs font-black">اصلاحیه‌ها (trace)</h3>
          {data.corrections.length === 0 ? <p className="text-xs text-ink/40">بدون اصلاحیه.</p> : (
            <ul className="space-y-1 text-xs">
              {data.corrections.map((c) => (
                <li key={c.id} className="flex justify-between">
                  <a href={`/pos/${encodeURIComponent(c.number)}`} className="font-bold text-primary-strong underline" dir="ltr">{c.number}</a>
                  <span className="text-ink/50">{new Date(c.createdAt).toLocaleString("fa-IR")}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
