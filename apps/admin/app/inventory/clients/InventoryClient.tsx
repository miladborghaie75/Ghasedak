"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface InventoryRow {
  sku: string; barcode: string | null; stockQty: number; reservedQty: number;
  lowStockThreshold: number; price: string; status: string;
  product: { name: string };
}
interface StocktakeRow { id: string; number: string; state: string; createdAt: string; _count: { items: number } }
interface StocktakeDetail extends StocktakeRow {
  items: Array<{ id: string; variantSku: string; systemQty: number; countedQty: number | null; difference: number | null; variant: { sku: string; product: { name: string } } }>;
}
interface Warehouse { id: string; code: string; name: string; type: string; active: boolean }
interface TransferRow { id: string; number: string; state: string; fromWarehouse: { name: string }; toWarehouse: { name: string }; _count: { items: number }; createdAt: string }
interface QuarantineRow { id: string; number: string; qty: number; reason: string; state: string; warehouse: { name: string }; variant: { sku: string; product: { name: string } }; createdAt: string }
interface DamageRow { id: string; number: string; kind: string; qty: number; state: string; unitCost: string; warehouse: { name: string }; variant: { sku: string; product: { name: string } }; createdAt: string }
interface ApprovalRow { id: string; createdAt: string; requestedById: string; payload: { number?: string; lines?: Array<{ sku: string; diff: number }> } }
interface SettingRow { key: string; value: unknown; type: string; defaultValue: unknown; description: string }

type Tab = "stock" | "stocktake" | "transfer" | "quarantine" | "damage" | "approvals" | "settings";

const TABS: Array<[Tab, string, string?]> = [
  ["stock", "موجودی"],
  ["stocktake", "انبارگردانی"],
  ["transfer", "انتقال بین‌انباری", "inventory.transfer"],
  ["quarantine", "قرنطینه", "inventory.quarantine"],
  ["damage", "خرابی/مفقودی", "inventory.damage"],
  ["approvals", "تایید تعدیل", "inventory.approve"],
  ["settings", "تنظیمات", "inventory.settings"],
];

/** موجودی + انبارگردانی + انتقال + قرنطینه + خرابی + تایید + تنظیمات — End-to-End (بند ۳۰–۴۰) */
export default function InventoryClient() {
  const { call, loading, permissions } = useAdminApi() as ReturnType<typeof useAdminApi> & { permissions?: string[] };
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("stock");
  const [bulkMode, setBulkMode] = useState<"percent" | "fixed">("percent");
  const [bulkAmount, setBulkAmount] = useState("");
  const [stocktakes, setStocktakes] = useState<StocktakeRow[]>([]);
  const [stDetail, setStDetail] = useState<StocktakeDetail | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [transferLines, setTransferLines] = useState<Array<{ sku: string; qty: string }>>([{ sku: "", qty: "" }]);
  const [trFrom, setTrFrom] = useState(""); const [trTo, setTrTo] = useState("");
  const [quarantines, setQuarantines] = useState<QuarantineRow[]>([]);
  const [qSku, setQSku] = useState(""); const [qQty, setQQty] = useState(""); const [qReason, setQReason] = useState("");
  const [damages, setDamages] = useState<DamageRow[]>([]);
  const [dSku, setDSku] = useState(""); const [dQty, setDQty] = useState(""); const [dKind, setDKind] = useState<"damage" | "loss">("damage"); const [dReason, setDReason] = useState(""); const [dHold, setDHold] = useState(false);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [settingsRows, setSettingsRows] = useState<SettingRow[]>([]);
  const [settingDraft, setSettingDraft] = useState<Record<string, string>>({});

  const has = (p?: string) => !p || (permissions ?? []).includes(p) || (permissions ?? []).length === 0;

  const load = async (query = "") => {
    const r = await call<{ items: InventoryRow[] }>(`/admin/inventory${query ? `?q=${encodeURIComponent(query)}` : ""}`);
    if (r.ok && r.data) setRows(r.data.items);
    else setError(r.error?.message ?? "خطا");
  };
  const loadStocktakes = async () => {
    const r = await call<{ items: StocktakeRow[] }>("/admin/stocktake");
    if (r.ok && r.data) setStocktakes(r.data.items);
  };
  const loadOps = async () => {
    const [w, t, qn, d, a, s] = await Promise.all([
      call<{ items: Warehouse[] }>("/admin/inventory-ops/warehouses"),
      call<{ items: TransferRow[] }>("/admin/inventory-ops/transfers"),
      call<{ items: QuarantineRow[] }>("/admin/inventory-ops/quarantine"),
      call<{ items: DamageRow[] }>("/admin/inventory-ops/damage"),
      call<{ items: ApprovalRow[] }>("/admin/inventory-ops/approvals").catch(() => ({ ok: false } as never)),
      call<{ items: SettingRow[] }>("/admin/inventory-ops/settings"),
    ]);
    if (w.ok && w.data) { setWarehouses(w.data.items); if (!trFrom && w.data.items[0]) setTrFrom(w.data.items[0].id); if (!trTo && w.data.items[1]) setTrTo(w.data.items[1].id); }
    if (t.ok && t.data) setTransfers(t.data.items);
    if (qn.ok && qn.data) setQuarantines(qn.data.items);
    if (d.ok && d.data) setDamages(d.data.items);
    if ((a as { ok: boolean; data?: { items: ApprovalRow[] } }).ok && (a as { data?: { items: ApprovalRow[] } }).data) setApprovals((a as { data: { items: ApprovalRow[] } }).data.items);
    if (s.ok && s.data) setSettingsRows(s.data.items);
  };
  useEffect(() => { void load(); void loadStocktakes(); void loadOps(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const flash = (ok: boolean, text: string) => { setMsg(ok ? text + " ✅" : null); setError(ok ? null : text); };

  const toggleSelect = (sku: string) => {
    const next = new Set(selected);
    if (next.has(sku)) next.delete(sku); else next.add(sku);
    setSelected(next);
  };
  const selectAll = () => {
    if (selected.size === rows.length) setSelected(new Set());
    else setSelected(new Set(rows.map((r) => r.sku)));
  };

  const bulkPrice = async () => {
    if (selected.size === 0 || !bulkAmount) { setError("کالا انتخاب و مقدار وارد کنید."); return; }
    const r = await call<{ changed: number }>("/admin/inventory/bulk-price", {
      method: "POST",
      body: JSON.stringify({ skus: [...selected], mode: bulkMode, amount: Number(bulkAmount) }),
    });
    flash(r.ok, r.ok ? `قیمت ${fa(r.data?.changed ?? 0)} کالا به‌روزرسانی شد` : r.error?.message ?? "خطا");
    if (r.ok) void load(q);
  };

  const bulkStatus = async (status: "PUBLISHED" | "DRAFT") => {
    if (selected.size === 0) return;
    const r = await call<{ changed: number }>("/admin/inventory/bulk-status", {
      method: "POST", body: JSON.stringify({ skus: [...selected], status }),
    });
    flash(r.ok, r.ok ? `وضعیت ${fa(r.data?.changed ?? 0)} کالا تغییر کرد` : r.error?.message ?? "خطا");
    if (r.ok) void load(q);
  };

  const startStocktake = async () => {
    const r = await call<{ number: string; items: number }>("/admin/stocktake", { method: "POST", body: JSON.stringify({}) });
    flash(r.ok, r.ok ? `انبارگردانی ${r.data?.number} با ${fa(r.data?.items ?? 0)} ردیف شروع شد` : r.error?.message ?? "خطا");
    if (r.ok) {
      await loadStocktakes();
      const list = (await call<{ items: StocktakeRow[] }>("/admin/stocktake")).data?.items;
      if (list?.length) await openStocktake(list[0].id);
    }
  };

  const openStocktake = async (id: string) => {
    const r = await call<StocktakeDetail>(`/admin/stocktake/${id}`);
    if (r.ok && r.data) { setStDetail(r.data); setCounts({}); }
  };

  const saveCount = async (itemId: string) => {
    if (!stDetail) return;
    const val = counts[itemId];
    if (val == null || val === "") return;
    const r = await call(`/admin/stocktake/${stDetail.id}/count`, {
      method: "POST", body: JSON.stringify({ itemId, countedQty: Number(val) }),
    });
    flash(r.ok, r.ok ? "ثبت شد" : r.error?.message ?? "خطا");
    if (r.ok) await openStocktake(stDetail.id);
  };

  const requestApproval = async () => {
    if (!stDetail) return;
    const r = await call<{ approvalNeeded: boolean; lines?: number }>(`/admin/inventory-ops/stocktake/${stDetail.id}/request-approval`, { method: "POST", body: JSON.stringify({}) });
    flash(r.ok, r.ok ? (r.data?.approvalNeeded ? `درخواست تایید برای ${fa(r.data.lines ?? 0)} ردیف ثبت شد` : "اختلاف بالای تحمل وجود ندارد") : r.error?.message ?? "خطا");
  };

  const closeStocktake = async () => {
    if (!stDetail) return;
    const r = await call<{ adjusted: number; lossValue: string }>(`/admin/stocktake/${stDetail.id}/close`, { method: "POST", body: JSON.stringify({}) });
    flash(r.ok, r.ok ? `انبارگردانی بسته شد — ${fa(r.data?.adjusted ?? 0)} ردیف تعدیل، ارزش کسری: ${fa(r.data?.lossValue ?? "0")} تومان` : r.error?.message ?? "خطا");
    if (r.ok) { setStDetail(null); await loadStocktakes(); void load(); }
  };

  // ---- انتقال ----
  const createTransfer = async () => {
    const lines = transferLines.filter((l) => l.sku && Number(l.qty) > 0).map((l) => ({ variantSku: l.sku.trim(), qty: Number(l.qty) }));
    if (!trFrom || !trTo || lines.length === 0) { setError("انبار مبدأ/مقصد و حداقل یک ردیف معتبر لازم است."); return; }
    const r = await call<{ number: string }>("/admin/inventory-ops/transfers", { method: "POST", body: JSON.stringify({ fromWarehouseId: trFrom, toWarehouseId: trTo, lines }) });
    flash(r.ok, r.ok ? `انتقال ${r.data?.number} ایجاد شد — برای خروج از انبار، ارسال بزنید` : r.error?.message ?? "خطا");
    if (r.ok) { setTransferLines([{ sku: "", qty: "" }]); await loadOps(); }
  };
  const transferAction = async (id: string, action: "confirm" | "receive" | "cancel") => {
    const r = await call(`/admin/inventory-ops/transfers/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    flash(r.ok, r.ok ? "انجام شد" : r.error?.message ?? "خطا");
    if (r.ok) { await loadOps(); void load(); }
  };

  // ---- قرنطینه ----
  const holdQuarantine = async () => {
    const wh = warehouses[0];
    if (!wh || !qSku || Number(qQty) <= 0 || !qReason) { setError("انبار، SKU، تعداد و دلیل لازم است."); return; }
    const r = await call("/admin/inventory-ops/quarantine", { method: "POST", body: JSON.stringify({ warehouseId: wh.id, variantSku: qSku.trim(), qty: Number(qQty), reason: qReason }) });
    flash(r.ok, r.ok ? "کالا به قرنطینه منتقل شد (از قابل‌فروش کسر شد)" : r.error?.message ?? "خطا");
    if (r.ok) { setQSku(""); setQQty(""); setQReason(""); await loadOps(); void load(); }
  };
  const quarantineAction = async (id: string, action: "release" | "destroy") => {
    const r = await call(`/admin/inventory-ops/quarantine/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    flash(r.ok, r.ok ? (action === "destroy" ? "انهدام شد و سند خسارت ثبت شد" : "به قابل‌فروش بازگشت") : r.error?.message ?? "خطا");
    if (r.ok) { await loadOps(); void load(); }
  };

  // ---- خرابی ----
  const reportDamage = async () => {
    const wh = warehouses[0];
    if (!wh || !dSku || Number(dQty) <= 0) { setError("انبار، SKU و تعداد لازم است."); return; }
    const r = await call("/admin/inventory-ops/damage", { method: "POST", body: JSON.stringify({ warehouseId: wh.id, variantSku: dSku.trim(), qty: Number(dQty), kind: dKind, reason: dReason || undefined, holdForApproval: dHold }) });
    flash(r.ok, r.ok ? (dHold ? "سند معلق ثبت شد — پس از تایید، post کنید" : "ثبت شد و از انبار کم شد") : r.error?.message ?? "خطا");
    if (r.ok) { setDSku(""); setDQty(""); setDReason(""); await loadOps(); void load(); }
  };
  const damageAction = async (id: string, action: "post" | "cancel") => {
    const r = await call(`/admin/inventory-ops/damage/${id}/${action}`, { method: "POST", body: JSON.stringify({}) });
    flash(r.ok, r.ok ? "انجام شد" : r.error?.message ?? "خطا");
    if (r.ok) { await loadOps(); void load(); }
  };

  // ---- تایید ----
  const decideApproval = async (id: string, approve: boolean) => {
    const r = await call(`/admin/inventory-ops/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ approve }) });
    flash(r.ok, r.ok ? (approve ? "تایید شد — حالا انبارگردانی قابل بستن است" : "رد شد") : r.error?.message ?? "خطا");
    if (r.ok) await loadOps();
  };

  // ---- تنظیمات ----
  const saveSetting = async (key: string) => {
    const raw = settingDraft[key];
    if (raw === undefined) return;
    const def = settingsRows.find((s) => s.key === key);
    let value: unknown = raw;
    if (def?.type === "number") value = Number(raw);
    if (def?.type === "boolean") value = raw === "true";
    const r = await call("/admin/inventory-ops/settings", { method: "POST", body: JSON.stringify({ key, value }) });
    flash(r.ok, r.ok ? "تنظیم ذخیره شد" : r.error?.message ?? "خطا");
    if (r.ok) await loadOps();
  };

  const stateFa: Record<string, string> = { DRAFT: "پیش‌نویس", IN_TRANSIT: "در راه", DONE: "انجام شد", CANCELLED: "لغو", HELD: "در قرنطینه", RELEASED: "آزاد", DESTROYED: "انهدام", POSTED: "ثبت‌شده" };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        {TABS.map(([k, label, perm]) => has(perm) ? (
          <button key={k} onClick={() => setTab(k)}
            className={`rounded-full px-4 py-2 text-xs font-bold ${tab === k ? "bg-primary text-white" : "border border-line bg-surface text-muted"}`}>
            {label}
          </button>
        ) : null)}
      </div>

      {msg ? <p className="rounded-xl bg-green-50 px-4 py-2 text-xs font-bold text-green-800">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-600">{error}</p> : null}

      {tab === "stock" && (
        <>
          <div className="flex gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(q)} placeholder="جستجو: نام محصول / SKU / بارکد…" className="h-10 w-72 rounded-full border border-line bg-white px-4 text-sm" />
            <button onClick={() => load(q)} disabled={loading} className="h-10 rounded-full bg-ink px-5 text-sm font-black text-white disabled:opacity-60">جستجو</button>
          </div>

          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-card border border-primary/30 bg-primary-tint/40 p-3">
              <span className="text-xs font-bold text-ink">{fa(selected.size)} کالا انتخاب شده:</span>
              <select value={bulkMode} onChange={(e) => setBulkMode(e.target.value as "percent" | "fixed")} className="rounded-lg border border-line bg-white px-2 py-1.5 text-xs">
                <option value="percent">تغییر درصدی</option>
                <option value="fixed">تغییر مبلغی (تومان)</option>
              </select>
              <input value={bulkAmount} onChange={(e) => setBulkAmount(e.target.value)} type="number" placeholder="مثلاً 10 یا -5" className="w-32 rounded-lg border border-line bg-white px-2 py-1.5 text-xs" />
              <button onClick={() => void bulkPrice()} disabled={loading} className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-white">اعمال قیمت</button>
              <button onClick={() => void bulkStatus("PUBLISHED")} disabled={loading} className="rounded-full border border-line px-3 py-1.5 text-xs font-bold">فعال‌سازی</button>
              <button onClick={() => void bulkStatus("DRAFT")} disabled={loading} className="rounded-full border border-line px-3 py-1.5 text-xs font-bold">غیرفعال‌سازی</button>
            </div>
          )}

          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-right text-xs text-ink/60">
                  <th className="px-4 py-3"><input type="checkbox" checked={selected.size === rows.length && rows.length > 0} onChange={selectAll} /></th>
                  <th className="px-4 py-3">محصول</th><th className="px-4 py-3">SKU</th><th className="px-4 py-3">بارکد</th>
                  <th className="px-4 py-3">OnHand</th><th className="px-4 py-3">رزرو</th><th className="px-4 py-3">قابل فروش</th>
                  <th className="px-4 py-3">قیمت</th><th className="px-4 py-3">وضعیت</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-8 text-center text-ink/50">موجودی‌ای یافت نشد.</td></tr>
                ) : rows.map((r) => {
                  const available = r.stockQty - r.reservedQty;
                  const low = r.stockQty <= r.lowStockThreshold;
                  return (
                    <tr key={r.sku} className={`border-b border-line/60 last:border-0 ${low ? "bg-amber-50/50" : ""}`}>
                      <td className="px-4 py-3"><input type="checkbox" checked={selected.has(r.sku)} onChange={() => toggleSelect(r.sku)} /></td>
                      <td className="px-4 py-3 font-bold">{r.product.name}</td>
                      <td className="px-4 py-3 text-xs" dir="ltr">{r.sku}</td>
                      <td className="px-4 py-3 text-xs" dir="ltr">{r.barcode ?? "—"}</td>
                      <td className="px-4 py-3 tabular-nums">{fa(r.stockQty)}</td>
                      <td className="px-4 py-3 tabular-nums text-ink/60">{fa(r.reservedQty)}</td>
                      <td className={`px-4 py-3 tabular-nums font-black ${low ? "text-amber-600" : "text-green-700"}`}>{fa(available)}</td>
                      <td className="px-4 py-3 tabular-nums">{fa(r.price)}</td>
                      <td className="px-4 py-3">{low ? "کم 🔶" : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "stocktake" && (
        <>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void startStocktake()} disabled={loading} className="h-10 rounded-full bg-primary px-5 text-sm font-black text-white disabled:opacity-60">شروع انبارگردانی جدید</button>
            {stDetail && <button onClick={() => void requestApproval()} disabled={loading} className="h-10 rounded-full border border-ink px-4 text-sm font-bold">درخواست تایید اختلاف‌های بزرگ</button>}
          </div>

          {stDetail && (
            <div className="rounded-card border border-line bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-black text-ink">انبارگردانی {stDetail.number}</h3>
                <div className="flex gap-2">
                  <button onClick={() => void closeStocktake()} disabled={loading} className="rounded-full bg-ink px-4 py-1.5 text-xs font-bold text-white">بستن و ثبت تعدیل‌ها</button>
                  <button onClick={() => setStDetail(null)} className="rounded-full border border-line px-4 py-1.5 text-xs font-bold">بستن نمایش</button>
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-line text-ink/60">
                    <th className="p-2 text-right">کالا</th><th className="p-2">SKU</th><th className="p-2">سیستم</th><th className="p-2">شمارش</th><th className="p-2">اختلاف</th><th className="p-2"></th>
                  </tr></thead>
                  <tbody>
                    {stDetail.items.map((it) => (
                      <tr key={it.id} className="border-b border-line/40">
                        <td className="p-2 font-bold">{it.variant.product.name}</td>
                        <td className="p-2" dir="ltr">{it.variantSku}</td>
                        <td className="p-2 text-center tabular-nums">{fa(it.systemQty)}</td>
                        <td className="p-2 text-center">
                          <input value={counts[it.id] ?? (it.countedQty != null ? String(it.countedQty) : "")}
                            onChange={(e) => setCounts({ ...counts, [it.id]: e.target.value })}
                            type="number" min={0} className="w-20 rounded border border-line px-2 py-1 text-center" />
                        </td>
                        <td className={`p-2 text-center tabular-nums font-bold ${(() => { const d = counts[it.id] != null ? Number(counts[it.id]) - it.systemQty : it.difference; return d != null && d > 0 ? "text-green-700" : d != null && d < 0 ? "text-red-600" : ""; })()}`}>
                          {counts[it.id] != null ? fa(Number(counts[it.id]) - it.systemQty) : it.difference != null ? fa(it.difference) : "—"}
                        </td>
                        <td className="p-2 text-center">
                          {counts[it.id] && <button onClick={() => void saveCount(it.id)} className="text-[10px] font-bold text-primary">ثبت</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">شماره</th><th className="p-3">وضعیت</th><th className="p-3">ردیف‌ها</th><th className="p-3">تاریخ</th><th className="p-3"></th>
              </tr></thead>
              <tbody>
                {stocktakes.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-ink/50">هنوز انبارگردانی انجام نشده است.</td></tr>
                ) : stocktakes.map((s) => (
                  <tr key={s.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold" dir="ltr">{s.number}</td>
                    <td className="p-3 text-center">{s.state === "OPEN" ? "باز" : "بسته"}</td>
                    <td className="p-3 text-center">{fa(s._count.items)}</td>
                    <td className="p-3 text-center text-xs">{new Date(s.createdAt).toLocaleDateString("fa-IR")}</td>
                    <td className="p-3 text-center">
                      <button onClick={() => void openStocktake(s.id)} className="rounded-full border border-line px-3 py-1 text-xs font-bold">مشاهده</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "transfer" && (
        <>
          <div className="rounded-card border border-line bg-surface p-4">
            <h3 className="mb-3 text-sm font-black">انتقال جدید</h3>
            <div className="mb-3 flex flex-wrap gap-2">
              <select value={trFrom} onChange={(e) => setTrFrom(e.target.value)} className="h-9 rounded-lg border border-line bg-white px-2 text-xs">
                <option value="">مبدأ…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
              <span className="self-center text-xs text-muted">→</span>
              <select value={trTo} onChange={(e) => setTrTo(e.target.value)} className="h-9 rounded-lg border border-line bg-white px-2 text-xs">
                <option value="">مقصد…</option>
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            {transferLines.map((l, i) => (
              <div key={i} className="mb-2 flex gap-2">
                <input value={l.sku} onChange={(e) => setTransferLines(transferLines.map((x, j) => j === i ? { ...x, sku: e.target.value } : x))} placeholder="SKU" dir="ltr" className="h-9 w-48 rounded-lg border border-line bg-white px-2 text-xs" />
                <input value={l.qty} onChange={(e) => setTransferLines(transferLines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} type="number" min={1} placeholder="تعداد" className="h-9 w-24 rounded-lg border border-line bg-white px-2 text-center text-xs" />
              </div>
            ))}
            <div className="flex gap-2">
              <button onClick={() => setTransferLines([...transferLines, { sku: "", qty: "" }])} className="rounded-full border border-line px-3 py-1.5 text-xs font-bold">+ ردیف</button>
              <button onClick={() => void createTransfer()} disabled={loading} className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-white">ایجاد انتقال</button>
            </div>
          </div>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">شماره</th><th className="p-3">مبدأ → مقصد</th><th className="p-3">ردیف‌ها</th><th className="p-3">وضعیت</th><th className="p-3">اقدام</th>
              </tr></thead>
              <tbody>
                {transfers.length === 0 ? (
                  <tr><td colSpan={5} className="p-6 text-center text-ink/50">انتقالی ثبت نشده است.</td></tr>
                ) : transfers.map((t) => (
                  <tr key={t.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold" dir="ltr">{t.number}</td>
                    <td className="p-3 text-xs">{t.fromWarehouse.name} → {t.toWarehouse.name}</td>
                    <td className="p-3 text-center">{fa(t._count.items)}</td>
                    <td className="p-3 text-center text-xs">{stateFa[t.state] ?? t.state}</td>
                    <td className="p-3 text-center">
                      {t.state === "DRAFT" && <button onClick={() => void transferAction(t.id, "confirm")} className="ml-1 rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">ارسال</button>}
                      {t.state === "IN_TRANSIT" && <button onClick={() => void transferAction(t.id, "receive")} className="ml-1 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">دریافت</button>}
                      {t.state === "DRAFT" && <button onClick={() => void transferAction(t.id, "cancel")} className="rounded-full border border-line px-3 py-1 text-xs font-bold">لغو</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "quarantine" && (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-4">
            <div><label className="mb-1 block text-[10px] text-muted">SKU</label><input value={qSku} onChange={(e) => setQSku(e.target.value)} dir="ltr" className="h-9 w-40 rounded-lg border border-line bg-white px-2 text-xs" /></div>
            <div><label className="mb-1 block text-[10px] text-muted">تعداد</label><input value={qQty} onChange={(e) => setQQty(e.target.value)} type="number" min={1} className="h-9 w-20 rounded-lg border border-line bg-white px-2 text-center text-xs" /></div>
            <div className="flex-1"><label className="mb-1 block text-[10px] text-muted">دلیل</label><input value={qReason} onChange={(e) => setQReason(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-white px-2 text-xs" /></div>
            <button onClick={() => void holdQuarantine()} disabled={loading} className="h-9 rounded-full bg-primary px-4 text-xs font-bold text-white">جداسازی</button>
          </div>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">شماره</th><th className="p-3">کالا</th><th className="p-3">تعداد</th><th className="p-3">دلیل</th><th className="p-3">وضعیت</th><th className="p-3">اقدام</th>
              </tr></thead>
              <tbody>
                {quarantines.length === 0 ? (
                  <tr><td colSpan={6} className="p-6 text-center text-ink/50">رکوردی وجود ندارد.</td></tr>
                ) : quarantines.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold" dir="ltr">{r.number}</td>
                    <td className="p-3 text-xs">{r.variant.product.name} <span dir="ltr" className="text-ink/50">({r.variant.sku})</span></td>
                    <td className="p-3 text-center tabular-nums">{fa(r.qty)}</td>
                    <td className="p-3 text-xs">{r.reason}</td>
                    <td className="p-3 text-center text-xs">{stateFa[r.state] ?? r.state}</td>
                    <td className="p-3 text-center">
                      {r.state === "HELD" && <>
                        <button onClick={() => void quarantineAction(r.id, "release")} className="ml-1 rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white">بازگشت</button>
                        <button onClick={() => void quarantineAction(r.id, "destroy")} className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">انهدام</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "damage" && (
        <>
          <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface p-4">
            <div><label className="mb-1 block text-[10px] text-muted">SKU</label><input value={dSku} onChange={(e) => setDSku(e.target.value)} dir="ltr" className="h-9 w-40 rounded-lg border border-line bg-white px-2 text-xs" /></div>
            <div><label className="mb-1 block text-[10px] text-muted">تعداد</label><input value={dQty} onChange={(e) => setDQty(e.target.value)} type="number" min={1} className="h-9 w-20 rounded-lg border border-line bg-white px-2 text-center text-xs" /></div>
            <div><label className="mb-1 block text-[10px] text-muted">نوع</label>
              <select value={dKind} onChange={(e) => setDKind(e.target.value as "damage" | "loss")} className="h-9 rounded-lg border border-line bg-white px-2 text-xs">
                <option value="damage">خرابی</option><option value="loss">مفقودی</option>
              </select>
            </div>
            <div className="flex-1"><label className="mb-1 block text-[10px] text-muted">دلیل</label><input value={dReason} onChange={(e) => setDReason(e.target.value)} className="h-9 w-full rounded-lg border border-line bg-white px-2 text-xs" /></div>
            <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={dHold} onChange={(e) => setDHold(e.target.checked)} /> معلق (نیازمند تایید)</label>
            <button onClick={() => void reportDamage()} disabled={loading} className="h-9 rounded-full bg-primary px-4 text-xs font-bold text-white">ثبت</button>
          </div>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line text-xs text-ink/60">
                <th className="p-3 text-right">شماره</th><th className="p-3">کالا</th><th className="p-3">نوع</th><th className="p-3">تعداد</th><th className="p-3">بها</th><th className="p-3">وضعیت</th><th className="p-3">اقدام</th>
              </tr></thead>
              <tbody>
                {damages.length === 0 ? (
                  <tr><td colSpan={7} className="p-6 text-center text-ink/50">سندی ثبت نشده است.</td></tr>
                ) : damages.map((r) => (
                  <tr key={r.id} className="border-b border-line/60 last:border-0">
                    <td className="p-3 font-bold" dir="ltr">{r.number}</td>
                    <td className="p-3 text-xs">{r.variant.product.name} <span dir="ltr" className="text-ink/50">({r.variant.sku})</span></td>
                    <td className="p-3 text-center text-xs">{r.kind === "loss" ? "مفقودی" : "خرابی"}</td>
                    <td className="p-3 text-center tabular-nums">{fa(r.qty)}</td>
                    <td className="p-3 text-center tabular-nums text-xs">{fa((Number(r.unitCost) * r.qty).toLocaleString("en"))}</td>
                    <td className="p-3 text-center text-xs">{stateFa[r.state] ?? r.state}</td>
                    <td className="p-3 text-center">
                      {r.state === "DRAFT" && <>
                        <button onClick={() => void damageAction(r.id, "post")} className="ml-1 rounded-full bg-ink px-3 py-1 text-xs font-bold text-white">ثبت نهایی</button>
                        <button onClick={() => void damageAction(r.id, "cancel")} className="rounded-full border border-line px-3 py-1 text-xs font-bold">لغو</button>
                      </>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "approvals" && (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-xs text-ink/60">
              <th className="p-3 text-right">انبارگردانی</th><th className="p-3">ردیف‌های نیازمند تایید</th><th className="p-3">تاریخ</th><th className="p-3">اقدام</th>
            </tr></thead>
            <tbody>
              {approvals.length === 0 ? (
                <tr><td colSpan={4} className="p-6 text-center text-ink/50">درخواست تاییدی در صف نیست.</td></tr>
              ) : approvals.map((a) => (
                <tr key={a.id} className="border-b border-line/60 last:border-0">
                  <td className="p-3 font-bold" dir="ltr">{a.payload.number ?? "—"}</td>
                  <td className="p-3 text-center">{fa(a.payload.lines?.length ?? 0)}</td>
                  <td className="p-3 text-center text-xs">{new Date(a.createdAt).toLocaleDateString("fa-IR")}</td>
                  <td className="p-3 text-center">
                    <button onClick={() => void decideApproval(a.id, true)} className="ml-1 rounded-full bg-green-600 px-3 py-1 text-xs font-bold text-white">تایید</button>
                    <button onClick={() => void decideApproval(a.id, false)} className="rounded-full border border-line px-3 py-1 text-xs font-bold">رد</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "settings" && (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line text-xs text-ink/60">
              <th className="p-3 text-right">کلید</th><th className="p-3">مقدار</th><th className="p-3">توضیح</th><th className="p-3"></th>
            </tr></thead>
            <tbody>
              {settingsRows.map((s) => (
                <tr key={s.key} className="border-b border-line/60 last:border-0">
                  <td className="p-3 font-bold text-xs" dir="ltr">{s.key}</td>
                  <td className="p-3">
                    {s.type === "boolean" ? (
                      <select defaultValue={String(s.value)} onChange={(e) => setSettingDraft({ ...settingDraft, [s.key]: e.target.value })} className="rounded-lg border border-line bg-white px-2 py-1 text-xs">
                        <option value="true">فعال</option><option value="false">غیرفعال</option>
                      </select>
                    ) : (
                      <input defaultValue={String(s.value ?? "")} onChange={(e) => setSettingDraft({ ...settingDraft, [s.key]: e.target.value })} type={s.type === "number" ? "number" : "text"} className="w-28 rounded-lg border border-line bg-white px-2 py-1 text-xs" />
                    )}
                  </td>
                  <td className="p-3 text-xs text-muted">{s.description}</td>
                  <td className="p-3 text-center">
                    {settingDraft[s.key] !== undefined && <button onClick={() => void saveSetting(s.key)} className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">ذخیره</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
