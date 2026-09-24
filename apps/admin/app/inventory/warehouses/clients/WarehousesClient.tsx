"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface Warehouse {
  id: string; code: string; name: string; type: string;
  address: string | null; phone: string | null; contact: string | null;
  isDefault: boolean; active: boolean; note: string | null;
}

const TYPES: Array<[string, string]> = [
  ["main", "اصلی"], ["store", "فروشگاه"], ["branch", "شعبه"],
  ["transit", "ترانزیت"], ["quarantine", "قرنطینه"], ["returns", "مرجوعی‌ها"], ["other", "سایر"],
];

/** CRUD انبار — قانون ۲/۵: Create/Edit/Activate/Deactivate با Permission و Audit سمت سرور */
export default function WarehousesClient() {
  const { call, loading, permissions } = useAdminApi();
  const [rows, setRows] = useState<Warehouse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", type: "store", address: "", phone: "", contact: "", note: "" });
  const canManage = (permissions ?? []).includes("inventory.manage");

  const load = async () => {
    const r = await call<{ items: Warehouse[] }>("/admin/inventory-ops/warehouses");
    if (r.ok && r.data) setRows(r.data.items);
    else setError(r.error?.message ?? "خطا");
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const create = async () => {
    const r = await call("/admin/inventory-ops/warehouses", { method: "POST", body: JSON.stringify(form) });
    setMsg(r.ok ? "انبار ایجاد شد ✅" : null); setError(r.ok ? null : r.error?.message ?? "خطا");
    if (r.ok) { setForm({ code: "", name: "", type: "store", address: "", phone: "", contact: "", note: "" }); await load(); }
  };

  const update = async (id: string, patch: Record<string, unknown>) => {
    const r = await call(`/admin/inventory-ops/warehouses/${id}`, { method: "POST", body: JSON.stringify(patch) });
    setMsg(r.ok ? "ذخیره شد ✅" : null); setError(r.ok ? null : r.error?.message ?? "خطا");
    if (r.ok) await load();
  };

  return (
    <div className="flex flex-col gap-5">
      {msg ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      {canManage && (
        <div className="rounded-card border border-line bg-surface p-4">
          <h3 className="mb-3 text-sm font-black">انبار جدید</h3>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="کد (نظیر WH2)" dir="ltr" className="h-9 rounded-lg border border-line bg-surface px-2 text-xs" />
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="نام انبار" className="h-9 rounded-lg border border-line bg-surface px-2 text-xs" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="h-9 rounded-lg border border-line bg-surface px-2 text-xs">
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="تلفن" dir="ltr" className="h-9 rounded-lg border border-line bg-surface px-2 text-xs" />
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="آدرس" className="col-span-2 h-9 rounded-lg border border-line bg-surface px-2 text-xs" />
            <input value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} placeholder="مسئول" className="h-9 rounded-lg border border-line bg-surface px-2 text-xs" />
            <button onClick={() => void create()} disabled={loading || !form.code || !form.name} className="h-9 rounded-full bg-primary px-4 text-xs font-bold text-on-accent disabled:opacity-50">ایجاد انبار</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-line text-right text-xs text-ink/60">
            <th className="px-4 py-3">کد</th><th className="px-4 py-3">نام</th><th className="px-4 py-3">نوع</th>
            <th className="px-4 py-3">مسئول</th><th className="px-4 py-3">پیش‌فرض</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">اقدام</th>
          </tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-bold" dir="ltr">{w.code}</td>
                <td className="px-4 py-3">{w.name}</td>
                <td className="px-4 py-3 text-xs">{TYPES.find(([v]) => v === w.type)?.[1] ?? w.type}</td>
                <td className="px-4 py-3 text-xs">{w.contact ?? "—"}</td>
                <td className="px-4 py-3 text-center">{w.isDefault ? "★" : ""}</td>
                <td className="px-4 py-3 text-center text-xs">
                  {w.active ? <span className="font-bold text-app-ok">فعال</span> : <span className="text-app-err">غیرفعال</span>}
                </td>
                <td className="px-4 py-3">
                  {canManage && (
                    <div className="flex gap-1">
                      <button onClick={() => void update(w.id, { active: !w.active })} className="rounded-full border border-line px-2 py-1 text-[10px] font-bold">
                        {w.active ? "غیرفعال" : "فعال"}
                      </button>
                      {!w.isDefault && <button onClick={() => void update(w.id, { isDefault: true })} className="rounded-full border border-line px-2 py-1 text-[10px] font-bold">پیش‌فرض کن</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/50">انباری ثبت نشده است.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">تعداد: {fa(rows.length)}</p>
    </div>
  );
}
