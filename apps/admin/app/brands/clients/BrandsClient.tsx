"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface BrandRow {
  id: string; name: string; slug: string; logoId: string | null;
  website: string | null; description: string | null; status: string; sortOrder: number;
  _count?: { products: number };
}

/** برندها — ایجاد/ویرایش با آیکون (logoId از Media Library) */
export default function BrandsClient() {
  const { call, loading } = useAdminApi();
  const [rows, setRows] = useState<BrandRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", website: "", description: "", logoId: "", sortOrder: 0 });

  const load = async () => {
    const r = await call<{ items: BrandRow[] }>("/admin/catalog/brands");
    if (r.ok && r.data) setRows(r.data.items);
    else setError(r.error?.message ?? "خطا");
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setMsg(null);
    const payload = { name: form.name, website: form.website || undefined, description: form.description || undefined, logoMediaId: form.logoId || null, sortOrder: Number(form.sortOrder) || 0 };
    const r = editId
      ? await call(`/admin/catalog/brands/${editId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await call("/admin/catalog/brands", { method: "POST", body: JSON.stringify(payload) });
    if (r.ok) {
      setMsg(editId ? "برند ویرایش شد." : "برند ایجاد شد ✅");
      setForm({ name: "", website: "", description: "", logoId: "", sortOrder: 0 });
      setEditId(null);
      void load();
    } else setError(r.error?.message ?? "خطا");
  };

  const del = async (id: string) => {
    if (!confirm("حذف برند؟")) return;
    const r = await call(`/admin/catalog/brands/${id}`, { method: "DELETE" });
    if (r.ok) void load(); else setError(r.error?.message ?? "خطا در حذف");
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-black text-ink">{editId ? "ویرایش برند" : "برند جدید"}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-bold text-ink/70">نام برند *<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold text-ink/70">وب‌سایت<input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} dir="ltr" placeholder="https://…" className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold text-ink/70">شناسه لوگو (Media)<input value={form.logoId} onChange={(e) => setForm({ ...form, logoId: e.target.value })} dir="ltr" placeholder="media id" className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold text-ink/70">توضیح<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold text-ink/70">ترتیب<input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm" /></label>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={loading} className="h-10 rounded-full bg-primary px-5 text-sm font-black text-white disabled:opacity-60">{editId ? "ذخیره" : "افزودن برند"}</button>
          {editId ? <button type="button" onClick={() => { setEditId(null); setForm({ name: "", website: "", description: "", logoId: "", sortOrder: 0 }); }} className="h-10 rounded-full border border-line px-5 text-sm font-bold">انصراف</button> : null}
        </div>
        {msg ? <p className="mt-3 text-xs font-bold text-green-700">{msg}</p> : null}
        {error ? <p className="mt-3 text-xs font-bold text-red-600">{error}</p> : null}
      </form>

      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">نام</th><th className="px-4 py-3">وب‌سایت</th><th className="px-4 py-3">محصولات</th><th className="px-4 py-3">ترتیب</th><th className="px-4 py-3">وضعیت</th><th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/50">هنوز برندی نیست.</td></tr>
            ) : rows.map((b) => (
              <tr key={b.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-bold">{b.name}</td>
                <td className="px-4 py-3 text-xs" dir="ltr">{b.website ?? "—"}</td>
                <td className="px-4 py-3 tabular-nums">{fa(b._count?.products ?? 0)}</td>
                <td className="px-4 py-3 tabular-nums">{fa(b.sortOrder)}</td>
                <td className="px-4 py-3">{b.status}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <button onClick={() => { setEditId(b.id); setForm({ name: b.name, website: b.website ?? "", description: b.description ?? "", logoId: b.logoId ?? "", sortOrder: b.sortOrder }); }} className="text-xs font-bold text-primary">ویرایش</button>
                    <button onClick={() => del(b.id)} className="text-xs font-bold text-red-600">حذف</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
