"use client";

/**
 * خرید از تامین‌کننده — بند ۲۷ Master:
 * فاکتور خرید به میزکار اختصاصی (/inventory/purchase/invoices/new) و صفحه جزئیات
 * (/inventory/purchase/invoices/[id]) منتقل شد — انتخاب کالا با ProductPicker و چاپ حرفه‌ای.
 * این صفحه لیست + PO + GRN + تامین‌کننده را نگه می‌دارد.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useAdminApi, fa } from "@/components/useAdminApi";
import ProductPicker from "@/components/commerce/ProductPicker";

interface Supplier { id: string; name: string; phone: string | null; email?: string | null; taxId?: string | null; account: { outstanding: string } | null }
interface PORow { id: string; number: string; status: string; supplier: { name: string }; _count: { items: number }; createdAt: string }
interface GRNRow { id: string; number: string; supplierId: string; supplier: { name: string }; warehouse: { name: string }; po: { number: string } | null; _count: { items: number }; receivedAt: string }
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
  const [supForm, setSupForm] = useState({ name: "", phone: "", email: "", taxId: "", notes: "" });
  const [poSupplier, setPoSupplier] = useState(""); const [poLines, setPoLines] = useState<Array<{ sku: string; qty: string; cost: string }>>([{ sku: "", qty: "", cost: "" }]);
  const [grnSupplier, setGrnSupplier] = useState(""); const [grnWarehouse, setGrnWarehouse] = useState(""); const [grnPoId, setGrnPoId] = useState("");
  const [grnLines, setGrnLines] = useState<Array<{ sku: string; qty: string; cost: string; landed: string }>>([{ sku: "", qty: "", cost: "", landed: "0" }]);
  const [payAmount, setPayAmount] = useState<Record<string, string>>({});
  const [pickerForGrn, setPickerForGrn] = useState(false);

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
    if (g.ok && g.data) setGrns(g.data.items);
    if (i.ok && i.data) setInvoices(i.data.items);
    if (w.ok && w.data) { setWarehouses(w.data.items); if (!grnWarehouse && w.data.items[0]) setGrnWarehouse(w.data.items[0].id); }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // ---- تامین‌کننده ----
  const createSupplier = async () => {
    const r = await call("/admin/purchasing/suppliers", { method: "POST", body: JSON.stringify(supForm) });
    flash(r.ok, r.ok ? "تامین‌کننده ثبت شد" : r.error?.message ?? "خطا");
    if (r.ok) { setSupForm({ name: "", phone: "", email: "", taxId: "", notes: "" }); await load(); }
  };

  // ---- ارسال فاکتور به تامین‌کننده (ایمیل/SMS) — آداپتور واقعی؛ بدون credential خطای صریح (بند ۱۱۱) ----
  const sendInvoice = async (invoiceId: string, channel: "EMAIL" | "SMS") => {
    const r = await call<{ delivery: { state: string }; error?: string; note?: string }>(
      `/admin/purchasing/purchase-invoices/${invoiceId}/send`,
      { method: "POST", body: JSON.stringify({ channel }) },
    );
    const state = r.data?.delivery?.state;
    if (!r.ok) flash(false, r.error?.message ?? "خطا در ارسال");
    else if (state === "SENT") flash(true, `فاکتور با ${channel === "EMAIL" ? "ایمیل" : "پیامک"} ارسال شد`);
    else if (state === "QUEUED") flash(false, r.data?.error ?? "بدون credential — فاکتور در صف ارسال ماند (بند ۱۱۱)");
    else flash(false, r.data?.error ?? "ارسال ناموفق — در تاریخچه تحویل ثبت شد");
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

  // ---- Invoice → میزکار اختصاصی (بند ۲۷) ----
  // ثبت فاکتور به /inventory/purchase/invoices/new منتقل شد (صفحه حرفه‌ای با ProductPicker و چاپ)

  const pay = async (invoiceId: string) => {
    const amount = Number(payAmount[invoiceId]);
    if (!amount || amount <= 0) { setError("مبلغ پرداخت را وارد کن."); return; }
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
              <input value={supForm.email} onChange={(e) => setSupForm({ ...supForm, email: e.target.value })} placeholder="ایمیل (برای ارسال فاکتور)" dir="ltr" className="h-9 w-44 rounded-lg border border-line bg-surface px-2 text-xs" />
              <input value={supForm.taxId} onChange={(e) => setSupForm({ ...supForm, taxId: e.target.value })} placeholder="شناسه مالیاتی" dir="ltr" className="h-9 w-32 rounded-lg border border-line bg-surface px-2 text-xs" />
              <input value={supForm.notes} onChange={(e) => setSupForm({ ...supForm, notes: e.target.value })} placeholder="یادداشت" className="h-9 w-40 rounded-lg border border-line bg-surface px-2 text-xs" />
              <button onClick={() => void createSupplier()} disabled={loading || !supForm.name} className="h-9 rounded-full bg-primary px-4 text-xs font-bold text-on-accent disabled:opacity-50">ثبت</button>
            </div>
          )}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="admin-table-wrap"><table className="w-full text-sm">
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
            </table></div>
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
                <button onClick={() => setPoLines([...poLines, { sku: "", qty: "", cost: "" }])} className="rounded-full border border-line px-3 py-1.5 text-xs font-bold">+ ردیف دستی</button>
                <button onClick={() => setPickerForGrn(true)} className="rounded-full border border-line px-3 py-1.5 text-xs font-bold">🔍 انتخاب کالا</button>
                <button onClick={() => void createPO()} disabled={loading} className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-on-accent">ثبت سفارش</button>
              </div>
            </div>
          )}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="admin-table-wrap"><table className="w-full text-sm">
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
            </table></div>
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
              <div className="flex gap-2">
                <button onClick={() => setPickerForGrn(true)} className="rounded-full border border-line px-3 py-1.5 text-xs font-bold">🔍 انتخاب کالا</button>
                <button onClick={() => void createGRN()} disabled={loading} className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-on-accent">ثبت دریافت</button>
              </div>
            </div>
          )}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="admin-table-wrap"><table className="w-full text-sm">
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
            </table></div>
          </div>
        </>
      )}

      {tab === "invoice" && (
        <>
          {canManage && (
            <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface p-4">
              <div className="flex-1">
                <h3 className="text-sm font-black">فاکتور خرید حرفه‌ای (Three-Way Match + AP)</h3>
                <p className="mt-1 text-[11px] text-muted">انتخاب کالا با جستجوی نام/SKU/بارکد، ایجاد سریع محصول، هزینه‌ها، پرداخت، پیوست و چاپ — در میزکار اختصاصی.</p>
              </div>
              <Link href="/inventory/purchase/invoices/new" className="h-9 rounded-full bg-primary px-4 text-xs font-black leading-9 text-on-accent">+ فاکتور خرید جدید</Link>
            </div>
          )}
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <div className="admin-table-wrap"><table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">شماره</th><th className="p-3">تامین‌کننده</th><th className="p-3">GRN</th><th className="p-3">مبلغ کل</th><th className="p-3">وضعیت</th><th className="p-3">ارسال به تامین‌کننده</th><th className="p-3">پرداخت / جزئیات</th>
              </tr></thead>
              <tbody>
                {invoices.map((iv) => (
                  <tr key={iv.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold" dir="ltr"><Link href={`/inventory/purchase/invoices/${iv.id}`} className="text-primary hover:underline">{iv.number}</Link></td>
                    <td className="p-3 text-xs">{iv.supplier.name}</td>
                    <td className="p-3 text-xs" dir="ltr">{iv.receipt?.number ?? "—"}</td>
                    <td className="p-3 text-center tabular-nums">{fa(iv.grandTotal)}</td>
                    <td className="p-3 text-center text-xs">{STATE_FA[iv.state] ?? iv.state}</td>
                    <td className="p-3">
                      {canManage ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => void sendInvoice(iv.id, "EMAIL")} title="ارسال با ایمیل تامین‌کننده" className="rounded-full border border-line px-2.5 py-1 text-xs font-bold hover:bg-app-primary-soft">✉️ ایمیل</button>
                          <button onClick={() => void sendInvoice(iv.id, "SMS")} title="ارسال با پیامک تامین‌کننده" className="rounded-full border border-line px-2.5 py-1 text-xs font-bold hover:bg-app-primary-soft">📱 پیامک</button>
                        </div>
                      ) : <span className="text-xs text-muted">—</span>}
                    </td>
                    <td className="p-3">
                      {canPay && iv.state !== "PAID" ? (
                        <div className="flex items-center gap-1">
                          <input value={payAmount[iv.id] ?? ""} onChange={(e) => setPayAmount({ ...payAmount, [iv.id]: e.target.value })} type="number" min={1} placeholder="مبلغ" className="w-24 rounded border border-line px-2 py-1 text-center text-xs" />
                          <button onClick={() => void pay(iv.id)} className="rounded-full bg-ink px-3 py-1 text-xs font-bold text-on-accent">پرداخت</button>
                        </div>
                      ) : <span className="text-xs text-muted">{fa(iv._count.payments)} پرداخت</span>}
                      <Link href={`/inventory/purchase/invoices/${iv.id}`} className="ms-2 text-xs font-bold text-primary hover:underline">جزئیات ←</Link>
                    </td>
                  </tr>
                ))}
                {invoices.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-ink/50">فاکتوری ثبت نشده است.</td></tr>}
              </tbody>
            </table></div>
          </div>
        </>
      )}

      {/* ProductPicker برای ردیف‌های PO/GRN — انتخاب کالا بدون تایپ دستی SKU (بند ۲۷/۳۳) */}
      <ProductPicker
        open={pickerForGrn}
        onClose={() => setPickerForGrn(false)}
        onPick={(v) => {
          // بر اساس تب فعال، ردیف را به فرم درست اضافه کن
          if (tab === "grn") {
            setGrnLines((prev) => {
              const existing = prev.findIndex((l) => l.sku === v.sku);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = { ...next[existing], qty: String((Number(next[existing].qty) || 0) + 1) };
                return next;
              }
              return [...prev, { sku: v.sku, qty: "1", cost: v.suggestedCost ?? v.price, landed: "0" }];
            });
          } else {
            setPoLines((prev) => {
              const existing = prev.findIndex((l) => l.sku === v.sku);
              if (existing >= 0) {
                const next = [...prev];
                next[existing] = { ...next[existing], qty: String((Number(next[existing].qty) || 0) + 1) };
                return next;
              }
              return [...prev, { sku: v.sku, qty: "1", cost: v.suggestedCost ?? v.price }];
            });
          }
        }}
        title={tab === "grn" ? "انتخاب کالا برای سند دریافت" : "انتخاب کالا برای سفارش خرید"}
      />
    </div>
  );
}
