"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface Supplier { id: string; name: string; phone: string | null; taxId?: string | null; account: { outstanding: string } | null }
interface POLine { variantSku: string; qty: number; unitCost: string }
interface PORow { id: string; number: string; status: string; supplier: { name: string }; _count: { items: number }; createdAt: string }
interface GRNRow { id: string; number: string; supplier: { name: string }; warehouse: { name: string }; po: { number: string } | null; _count: { items: number }; receivedAt: string }
interface InvRow { id: string; number: string; state: string; supplier: { name: string }; receipt: { number: string } | null; grandTotal: string; dueDate: string | null; _count: { payments: number } }
interface Warehouse { id: string; code: string; name: string }

type Tab = "suppliers" | "po" | "grn" | "invoice";

const TABS: Array<[Tab, string]> = [
  ["suppliers", "تامین‌کنندگان"],
  ["po", "سفارش خرید"],
  ["grn", "دریافت کالا (GRN)"],
  ["invoice", "فاکتور خرید و پرداخت"],
];

const STATE_FA: Record<string, string> = {
  DRAFT: "پیش‌نویس", SENT: "ارسال‌شده", RECEIVED: "دریافت شد", CLOSED: "بسته", CANCELLED: "لغو",
  POSTED: "ثبت‌شده", PAID: "تسویه‌شده", PARTIALLY_PAID: "تسویه جزئی",
};

/** چرخه خرید End-to-End — بند ۲۷–۲۹/۴۳ */
export default function PurchaseClient() {
  const { call, loading, permissions } = useAdminApi();
  const [tab, setTab] = useState<Tab>("suppliers");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [pos, setPos] = useState<PORow[]>([]);
  const [grns, setGrns] = useState<GRNRow[]>([]);
  const [invoices, setInvoices] = useState<InvRow[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const canManage = (permissions ?? []).includes("purchasing.manage");
  const canPay = (permissions ?? []).includes("purchasing.pay");

  // فرم‌ها
  const [supForm, setSupForm] = useState({ name: "", phone: "", taxId: "", notes: "" });
  const [poSupplier, setPoSupplier] = useState(""); const [poLines, setPoLines] = useState<Array<{ sku: string; qty: string; cost: string }>>([{ sku: "", qty: "", cost: "" }]);
  const [grnSupplier, setGrnSupplier] = useState(""); const [grnWarehouse, setGrnWarehouse] = useState(""); const [grnPoId, setGrnPoId] = useState("");
  const [grnLines, setGrnLines] = useState<Array<{ sku: string; qty: string; cost: string; landed: string }>>([{ sku: "", qty: "", cost: "", landed: "0" }]);
  const [invGrn, setInvGrn] = useState(""); const [invLines, setInvLines] = useState<Array<{ sku: string; qty: string; cost: string }>>([{ sku: "", qty: "", cost: "" }]);
  const [invShipping, setInvShipping] = useState("0"); const [invTax, setInvTax] = useState("0");
  const [payAmount, setPayAmount] = useState<Record<string, string>>({});

  const flash = (ok: boolean, text: string) => { setMsg(ok ? text + " ✅" : null); setError(ok ? null : text); };

  const load = async () => {
    const [s, p, g, i, w] = await Promise.all([
      call<{ items: Supplier[] }>("/admin/purchasing/suppliers"),
      call<{ items: PORow[] }>("/admin/purchasing/purchase-orders"),
      call<{ items: GRNRow[] }>("/admin/purchasing/goods-receipts"),
      call<{ items: InvRow[] }>("/admin/purchasing/purchase-invoices"),
      call<{ items: Warehouse[] }>("/admin/inventory-ops/warehouses"),
    ]);
    if (s.ok && s.data) { setSuppliers(s.data.items); if (!poSupplier && s.data.items[0]) setPoSupplier(s.data.items[0].id); if (!grnSupplier && s.data.items[0]) setGrnSupplier(s.data.items[0].id); }
    if (p.ok && p.data) setPos(p.data.items);
    if (g.ok && g.data) { setGrns(g.data.items); if (!invGrn && g.data.items[0]) setInvGrn(g.data.items[0].id); }
    if (i.ok && i.data) setInvoices(i.data.items);
    if (w.ok && w.data) { setWarehouses(w.data.items); if (!grnWarehouse && w.data.items[0]) setGrnWarehouse(w.data.items[0].id); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ---- تامین‌کننده ----
  const createSupplier = async () => {
    const r = await call("/admin/purchasing/suppliers", { method: "POST", body: JSON.stringify(supForm) });
    flash(r.ok, r.ok ? "تامین‌کننده ثبت شد" : r.error?.message ?? "خطا");
    if (r.ok) { setSupForm({ name: "", phone: "", taxId: "", notes: "" }); await load(); }
  };

  // ---- PO ----
  const createPO = async () => {
    const lines = poLines.filter((l) => l.sku && Number(l.qty) > 0).map((l) => ({ variantSku: l.sku.trim(), qty: Number(l.qty), unitCost: Number(l.cost) }));
    if (!poSupplier || lines.length === 0) { setError("تامین‌کننده و حداقل یک ردیف معتبر لازم است."); return; }
    const r = await call<{ number: string }>("/admin/purchasing/purchase-orders", { method: "POST", body: JSON.stringify({ supplierId: poSupplier, lines }) });
    flash(r.ok, r.ok ? `سفارش خرید ${r.data?.number} ثبت شد` : r.error?.message ?? "خطا");
    if (r.ok) { setPoLines([{ sku: "", qty: "", cost: "" }]); await load(); }
  };
  const poAction = async (id: string, action: "send" | "cancel") => {
    const r = await call(`/admin/purchasing/purchase-orders/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    flash(r.ok, r.ok ? "انجام شد" : r.error?.message ?? "خطا");
    if (r.ok) await load();
  };

  // ---- GRN ----
  const createGRN = async () => {
    const lines = grnLines.filter((l) => l.sku && Number(l.qty) > 0).map((l) => ({
      variantSku: l.sku.trim(), qty: Number(l.qty), unitCost: Number(l.cost), landedCost: Number(l.landed || 0),
    }));
    if (!grnSupplier || !grnWarehouse || lines.length === 0) { setError("تامین‌کننده، انبار و حداقل یک ردیف معتبر لازم است."); return; }
    const r = await call<{ number: string }>("/admin/purchasing/goods-receipts", { method: "POST", body: JSON.stringify({ supplierId: grnSupplier, warehouseId: grnWarehouse, poId: grnPoId || undefined, lines }) });
    flash(r.ok, r.ok ? `دریافت ${r.data?.number} ثبت شد — موجودی انبار به‌روز شد` : r.error?.message ?? "خطا");
    if (r.ok) { setGrnLines([{ sku: "", qty: "", cost: "", landed: "0" }]); setGrnPoId(""); await load(); }
  };

  // ---- Invoice ----
  const createInvoice = async () => {
    const lines = invLines.filter((l) => l.sku && Number(l.qty) > 0).map((l) => ({ variantSku: l.sku.trim(), qty: Number(l.qty), unitCost: Number(l.cost) }));
    if (!invGrn || lines.length === 0) { setError("سند دریافت و حداقل یک ردیف معتبر لازم است."); return; }
    const r = await call<{ invoice: { number: string }; ppvLines: unknown[] }>("/admin/purchasing/purchase-invoices", {
      method: "POST", body: JSON.stringify({ supplierId: suppliers[0]?.id ?? "", grnId: invGrn, lines, shippingTotal: Number(invShipping), taxTotal: Number(invTax) }),
    });
    flash(r.ok, r.ok ? `فاکتور ${r.data?.invoice?.number} ثبت شد` + (r.data?.ppvLines?.length ? ` — ${fa(r.data.ppvLines.length)} ردیف مغایرت بها (PPV)` : "") : r.error?.message ?? "خطا");
    if (r.ok) { setInvLines([{ sku: "", qty: "", cost: "" }]); await load(); }
  };

  const pay = async (invoiceId: string) => {
    const amount = Number(payAmount[invoiceId]);
    if (!amount || amount <= 0) { setError("مبلغ پرداخت را وارد کنید."); return; }
    const r = await call(`/admin/purchasing/purchase-invoices/${invoiceId}/pay`, { method: "POST", body: JSON.stringify({ amount }) });
    flash(r.ok, r.ok ? `پرداخت ${fa(amount)} تومان ثبت شد` : r.error?.message ?? "خطا");
    if (r.ok) { setPayAmount({ ...payAmount, [invoiceId]: "" }); await load(); }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-4 py-2 text-xs font-bold ${tab === k ? "bg-primary text-on-accent" : "border border-line bg-surface text-muted"}`}>
            {label}
          </button>
        ))}
      </div>
      {msg ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      {tab === "suppliers" && (
        <>
          {canManage && (
            <div className="flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-4">
              <input value={supForm.name} onChange={(e) => setSupForm({ ...supForm, name: e.target.value })} placeholder="نام تامین‌کننده" className="h-9 w-48 rounded-lg border border-line bg-surface px-2 text-xs" />
              <input value={supForm.phone} onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })} placeholder="تلفن" dir="ltr" className="h-9 w-32 rounded-lg border border-line bg-surface px-2 text-xs" />
              <input value={supForm.taxId} onChange={(e) => setSupForm({ ...supForm, taxId: e.target.value })} placeholder="شناسه مالیاتی" dir="ltr" className="h-9 w-32 rounded-lg border border-line bg-surface px-2 text-xs" />
              <input value={supForm.notes} onChange={(e) => setSupForm({ ...supForm, notes: e.target.value })} placeholder="یادداشت" className="h-9 w-40 rounded-lg border border-line bg-surface px-2 text-xs" />
              <button onClick={() => void createSupplier()} disabled={loading || !supForm.name} className="h-9 rounded-full bg-primary px-4 text-xs font-bold text-on-accent disabled:opacity-50">ثبت</button>
            </div>
          )}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">نام</th><th className="p-3">تلفن</th><th className="p-3">شناسه مالیاتی</th><th className="p-3">مانده بدهی (AP)</th>
              </tr></thead>
              <tbody>
                {suppliers.map((s) => (
                  <tr key={s.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold">{s.name}</td>
                    <td className="p-3 text-xs" dir="ltr">{s.phone ?? "—"}</td>
                    <td className="p-3 text-xs" dir="ltr">{s.taxId ?? "—"}</td>
                    <td className="p-3 text-center tabular-nums">{s.account ? fa(s.account.outstanding) : "—"}</td>
                  </tr>
                ))}
                {suppliers.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-ink/50">تامین‌کننده‌ای ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "po" && (
        <>
          {canManage && (
            <div className="rounded-card border border-line bg-surface p-4">
              <h3 className="mb-3 text-sm font-black">سفارش خرید جدید</h3>
              <select value={poSupplier} onChange={(e) => setPoSupplier(e.target.value)} className="mb-3 h-9 rounded-lg border border-line bg-surface px-2 text-xs">
                <option value="">تامین‌کننده…</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              {poLines.map((l, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input value={l.sku} onChange={(e) => setPoLines(poLines.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} placeholder="SKU" dir="ltr" className="h-9 w-40 rounded-lg border border-line bg-surface px-2 text-xs" />
                  <input value={l.qty} onChange={(e) => setPoLines(poLines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} type="number" min={1} placeholder="تعداد" className="h-9 w-20 rounded-lg border border-line bg-surface px-2 text-center text-xs" />
                  <input value={l.cost} onChange={(e) => setPoLines(poLines.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))} type="number" min={0} placeholder="بها (تومان)" className="h-9 w-32 rounded-lg border border-line bg-surface px-2 text-center text-xs" />
                </div>
              ))}
              <div className="flex gap-2">
                <button onClick={() => setPoLines([...poLines, { sku: "", qty: "", cost: "" }])} className="rounded-full border border-line px-3 py-1.5 text-xs font-bold">+ ردیف</button>
                <button onClick={() => void createPO()} disabled={loading} className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-on-accent">ثبت سفارش</button>
              </div>
            </div>
          )}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">شماره</th><th className="p-3">تامین‌کننده</th><th className="p-3">ردیف‌ها</th><th className="p-3">وضعیت</th><th className="p-3">اقدام</th>
              </tr></thead>
              <tbody>
                {pos.map((p) => (
                  <tr key={p.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold" dir="ltr">{p.number}</td>
                    <td className="p-3 text-xs">{p.supplier.name}</td>
                    <td className="p-3 text-center">{fa(p._count.items)}</td>
                    <td className="p-3 text-center text-xs">{STATE_FA[p.status] ?? p.status}</td>
                    <td className="p-3 text-center">
                      {canManage && p.status === "DRAFT" && <>
                        <button onClick={() => void poAction(p.id, "send")} className="ml-1 rounded-full bg-ink px-3 py-1 text-xs font-bold text-on-accent">ارسال</button>
                        <button onClick={() => void poAction(p.id, "cancel")} className="rounded-full border border-line px-3 py-1 text-xs font-bold">لغو</button>
                      </>}
                    </td>
                  </tr>
                ))}
                {pos.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-ink/50">سفارش خریدی ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "grn" && (
        <>
          {canManage && (
            <div className="rounded-card border border-line bg-surface p-4">
              <h3 className="mb-3 text-sm font-black">دریافت کالا</h3>
              <div className="mb-3 flex flex-wrap gap-2">
                <select value={grnSupplier} onChange={(e) => setGrnSupplier(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-xs">
                  <option value="">تامین‌کننده…</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select value={grnWarehouse} onChange={(e) => setGrnWarehouse(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-xs">
                  <option value="">انبار…</option>
                  {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                <select value={grnPoId} onChange={(e) => setGrnPoId(e.target.value)} className="h-9 rounded-lg border border-line bg-surface px-2 text-xs">
                  <option value="">بدون PO (خرید مستقیم)</option>
                  {pos.filter((p) => p.status === "SENT").map((p) => <option key={p.id} value={p.id}>PO {p.number}</option>)}
                </select>
              </div>
              {grnLines.map((l, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input value={l.sku} onChange={(e) => setGrnLines(grnLines.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} placeholder="SKU" dir="ltr" className="h-9 w-40 rounded-lg border border-line bg-surface px-2 text-xs" />
                  <input value={l.qty} onChange={(e) => setGrnLines(grnLines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} type="number" min={1} placeholder="تعداد" className="h-9 w-20 rounded-lg border border-line bg-surface px-2 text-center text-xs" />
                  <input value={l.cost} onChange={(e) => setGrnLines(grnLines.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))} type="number" min={0} placeholder="بها" className="h-9 w-28 rounded-lg border border-line bg-surface px-2 text-center text-xs" />
                  <input value={l.landed} onChange={(e) => setGrnLines(grnLines.map((x, j) => j === i ? { ...x, landed: e.target.value } : x))} type="number" min={0} placeholder="هزینه سربه‌دار" className="h-9 w-28 rounded-lg border border-line bg-surface px-2 text-center text-xs" />
                </div>
              ))}
              <button onClick={() => void createGRN()} disabled={loading} className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-on-accent">ثبت دریافت</button>
            </div>
          )}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">شماره</th><th className="p-3">تامین‌کننده</th><th className="p-3">انبار</th><th className="p-3">PO</th><th className="p-3">ردیف‌ها</th><th className="p-3">تاریخ</th>
              </tr></thead>
              <tbody>
                {grns.map((g) => (
                  <tr key={g.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold" dir="ltr">{g.number}</td>
                    <td className="p-3 text-xs">{g.supplier.name}</td>
                    <td className="p-3 text-xs">{g.warehouse.name}</td>
                    <td className="p-3 text-xs" dir="ltr">{g.po?.number ?? "—"}</td>
                    <td className="p-3 text-center">{fa(g._count.items)}</td>
                    <td className="p-3 text-center text-xs">{new Date(g.receivedAt).toLocaleDateString("fa-IR")}</td>
                  </tr>
                ))}
                {grns.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink/50">دریافتی ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "invoice" && (
        <>
          {canManage && (
            <div className="rounded-card border border-line bg-surface p-4">
              <h3 className="mb-3 text-sm font-black">ثبت فاکتور خرید (Three-Way Match)</h3>
              <select value={invGrn} onChange={(e) => setInvGrn(e.target.value)} className="mb-3 h-9 w-56 rounded-lg border border-line bg-surface px-2 text-xs">
                <option value="">سند دریافت…</option>
                {grns.map((g) => <option key={g.id} value={g.id}>{g.number} — {g.supplier.name}</option>)}
              </select>
              {invLines.map((l, i) => (
                <div key={i} className="mb-2 flex gap-2">
                  <input value={l.sku} onChange={(e) => setInvLines(invLines.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} placeholder="SKU" dir="ltr" className="h-9 w-40 rounded-lg border border-line bg-surface px-2 text-xs" />
                  <input value={l.qty} onChange={(e) => setInvLines(invLines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} type="number" min={1} placeholder="تعداد" className="h-9 w-20 rounded-lg border border-line bg-surface px-2 text-center text-xs" />
                  <input value={l.cost} onChange={(e) => setInvLines(invLines.map((x, j) => j === i ? { ...x, cost: e.target.value } : x))} type="number" min={0} placeholder="بها فاکتور" className="h-9 w-28 rounded-lg border border-line bg-surface px-2 text-center text-xs" />
                </div>
              ))}
              <div className="mb-3 flex gap-2">
                <label className="text-xs">حمل: <input value={invShipping} onChange={(e) => setInvShipping(e.target.value)} type="number" min={0} className="w-28 rounded-lg border border-line bg-surface px-2 py-1 text-center text-xs" /></label>
                <label className="text-xs">مالیات: <input value={invTax} onChange={(e) => setInvTax(e.target.value)} type="number" min={0} className="w-28 rounded-lg border border-line bg-surface px-2 py-1 text-center text-xs" /></label>
              </div>
              <button onClick={() => void createInvoice()} disabled={loading} className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-on-accent">ثبت فاکتور</button>
              <p className="mt-2 text-[10px] text-muted">تعداد هر ردیف باید دقیقاً با سند دریافت یکی باشد؛ بهای متفاوت از PO به‌عنوان مغایرت قیمت (PPV) رویداد ثبت می‌کند.</p>
            </div>
          )}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">شماره</th><th className="p-3">تامین‌کننده</th><th className="p-3">GRN</th><th className="p-3">مبلغ کل</th><th className="p-3">وضعیت</th><th className="p-3">پرداخت</th>
              </tr></thead>
              <tbody>
                {invoices.map((iv) => (
                  <tr key={iv.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold" dir="ltr">{iv.number}</td>
                    <td className="p-3 text-xs">{iv.supplier.name}</td>
                    <td className="p-3 text-xs" dir="ltr">{iv.receipt?.number ?? "—"}</td>
                    <td className="p-3 text-center tabular-nums">{fa(iv.grandTotal)}</td>
                    <td className="p-3 text-center text-xs">{STATE_FA[iv.state] ?? iv.state}</td>
                    <td className="p-3">
                      {canPay && iv.state !== "PAID" ? (
                        <div className="flex items-center gap-1">
                          <input value={payAmount[iv.id] ?? ""} onChange={(e) => setPayAmount({ ...payAmount, [iv.id]: e.target.value })} type="number" min={1} placeholder="مبلغ" className="w-24 rounded border border-line px-2 py-1 text-center text-xs" />
                          <button onClick={() => void pay(iv.id)} className="rounded-full bg-ink px-3 py-1 text-xs font-bold text-on-accent">پرداخت</button>
                        </div>
                      ) : <span className="text-xs text-muted">{fa(iv._count.payments)} پرداخت</span>}
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-ink/50">فاکتوری ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
