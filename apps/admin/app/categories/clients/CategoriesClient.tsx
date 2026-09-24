"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface CategoryRow {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  status: string;
  description?: string | null;
  parent?: { name: string } | null;
  _count?: { products: number; children: number };
}

interface FlatNode extends CategoryRow {
  depth: number;
}

/** دسته‌ها — درخت تا ۵ سطح (بند ۸: دسته/زیردسته/زیردسته زیردسته) */
export default function CategoriesClient() {
  const { call, loading } = useAdminApi();
  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", parentId: "", description: "", sortOrder: 0 });
  const [editId, setEditId] = useState<string | null>(null);

  const load = async () => {
    const r = await call<{ items: CategoryRow[] }>("/admin/catalog/categories");
    if (r.ok && r.data) setRows(r.data.items);
    else setError(r.error?.message ?? "خطا در دریافت دسته‌ها");
  };
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tree = useMemo<FlatNode[]>(() => {
    const byParent = new Map<string | null, CategoryRow[]>();
    for (const r of rows) {
      const key = r.parentId ?? null;
      (byParent.get(key) ?? byParent.set(key, []).get(key)!).push(r);
    }
    const out: FlatNode[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const r of byParent.get(parent) ?? []) {
        out.push({ ...r, depth });
        if (depth < 5) walk(r.id, depth + 1);
      }
    };
    walk(null, 1);
    return out;
  }, [rows]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const payload = {
      name: form.name,
      parentId: form.parentId || null,
      description: form.description || undefined,
      sortOrder: Number(form.sortOrder) || 0,
    };
    const r = editId
      ? await call(`/admin/catalog/categories/${editId}`, { method: "PATCH", body: JSON.stringify(payload) })
      : await call("/admin/catalog/categories", { method: "POST", body: JSON.stringify(payload) });
    if (r.ok) {
      setMsg(editId ? "دسته ویرایش شد." : "دسته ایجاد شد.");
      setForm({ name: "", parentId: "", description: "", sortOrder: 0 });
      setEditId(null);
      void load();
    } else {
      setError(r.error?.message ?? "خطا");
    }
  };

  const del = async (id: string) => {
    if (!confirm("حذف دسته؟")) return;
    const r = await call(`/admin/catalog/categories/${id}`, { method: "DELETE" });
    if (r.ok) void load();
    else setError(r.error?.message ?? "خطا در حذف");
  };

  const startEdit = (c: CategoryRow) => {
    setEditId(c.id);
    setForm({ name: c.name, parentId: c.parentId ?? "", description: c.description ?? "", sortOrder: c.sortOrder });
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-black text-ink">{editId ? "ویرایش دسته" : "دسته جدید"}</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs font-bold text-ink/70">
            نام دسته *
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-bold text-ink/70">
            دسته والد
            <select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <option value="">— ریشه (سطح ۱) —</option>
              {tree.map((t) => (
                <option key={t.id} value={t.id} disabled={t.depth >= 5}>
                  {"— ".repeat(t.depth - 1)}{t.name} (سطح {t.depth})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-ink/70">
            توضیح
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-bold text-ink/70">
            ترتیب
            <input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
          </label>
        </div>
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={loading} className="h-10 rounded-full bg-primary px-5 text-sm font-black text-on-accent disabled:opacity-60">
            {editId ? "ذخیره ویرایش" : "افزودن دسته"}
          </button>
          {editId ? (
            <button type="button" onClick={() => { setEditId(null); setForm({ name: "", parentId: "", description: "", sortOrder: 0 }); }} className="h-10 rounded-full border border-line px-5 text-sm font-bold">
              انصراف
            </button>
          ) : null}
        </div>
        {msg ? <p className="mt-3 text-xs font-bold text-app-ok">{msg}</p> : null}
        {error ? <p className="mt-3 text-xs font-bold text-app-err">{error}</p> : null}
      </form>

      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">نام</th>
              <th className="px-4 py-3">سطح</th>
              <th className="px-4 py-3">والد</th>
              <th className="px-4 py-3">محصولات</th>
              <th className="px-4 py-3">زیردسته</th>
              <th className="px-4 py-3">ترتیب</th>
              <th className="px-4 py-3">وضعیت</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {tree.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-ink/50">هنوز دسته‌ای نیست.</td></tr>
            ) : (
              tree.map((t) => (
                <tr key={t.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3 font-bold" style={{ paddingRight: `${12 + (t.depth - 1) * 20}px` }}>
                    {t.depth > 1 ? "↳ " : ""}{t.name}
                  </td>
                  <td className="px-4 py-3">{fa(t.depth)}</td>
                  <td className="px-4 py-3 text-ink/60">{t.parent?.name ?? "—"}</td>
                  <td className="px-4 py-3 tabular-nums">{fa(t._count?.products ?? 0)}</td>
                  <td className="px-4 py-3 tabular-nums">{fa(t._count?.children ?? 0)}</td>
                  <td className="px-4 py-3 tabular-nums">{fa(t.sortOrder)}</td>
                  <td className="px-4 py-3">{t.status}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(t)} className="text-xs font-bold text-primary">ویرایش</button>
                      <button onClick={() => del(t.id)} className="text-xs font-bold text-app-err">حذف</button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
