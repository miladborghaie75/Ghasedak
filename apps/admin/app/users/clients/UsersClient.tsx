"use client";

import { useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface UserRow {
  id: string; email: string | null; mobile: string | null; name: string | null;
  role: string; status: string; lastLoginAt: string | null; createdAt: string;
}

const ROLES = [
  { value: "SUPER_ADMIN", label: "مدیر ارشد" },
  { value: "STORE_MANAGER", label: "مدیر فروشگاه" },
  { value: "PRODUCT_MANAGER", label: "مدیر محصول" },
  { value: "ORDER_MANAGER", label: "مدیر سفارش‌ها" },
  { value: "CONTENT_MANAGER", label: "مدیر محتوا" },
  { value: "ACCOUNTANT", label: "حسابدار" },
  { value: "CASHIER", label: "صندوقدار" },
  { value: "INVENTORY_MANAGER", label: "مدیر انبار" },
  { value: "SALES_MANAGER", label: "مدیر فروش" },
  { value: "MARKETING_MANAGER", label: "مدیر بازاریابی" },
  { value: "SUPPORT_AGENT", label: "پشتیبانی" },
];

const ROLE_FA: Record<string, string> = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

/** کاربران — تعریف کاربر جدید با سطح دسترسی (RBAC بند ۷) */
export default function UsersClient() {
  const { call, loading } = useAdminApi();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "SUPPORT_AGENT", mobile: "" });

  const load = async () => {
    const r = await call<{ items: UserRow[] }>("/admin/users");
    if (r.ok && r.data) setRows(r.data.items);
    else setError(r.error?.message ?? "خطا");
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setMsg(null);
    const r = await call("/admin/users", { method: "POST", body: JSON.stringify({ ...form, mobile: form.mobile || undefined }) });
    if (r.ok) {
      setMsg("کاربر ایجاد شد ✅");
      setForm({ name: "", email: "", password: "", role: "SUPPORT_AGENT", mobile: "" });
      void load();
    } else setError(r.error?.message ?? "خطا");
  };

  const toggleStatus = async (u: UserRow) => {
    const next = u.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE";
    const r = await call(`/admin/users/${u.id}/status`, { method: "POST", body: JSON.stringify({ status: next }) });
    if (r.ok) void load(); else setError(r.error?.message ?? "خطا");
  };

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-black text-ink">کاربر ادمین جدید</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-xs font-bold text-ink/70">نام<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold text-ink/70">ایمیل *<input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required dir="ltr" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold text-ink/70">رمز عبور * (≥۸)<input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} dir="ltr" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" /></label>
          <label className="text-xs font-bold text-ink/70">نقش / سطح دسترسی *
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-ink/70">موبایل<input value={form.mobile} onChange={(e) => setForm({ ...form, mobile: e.target.value })} dir="ltr" placeholder="09…" className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" /></label>
        </div>
        <button type="submit" disabled={loading} className="mt-4 h-10 rounded-full bg-primary px-5 text-sm font-black text-on-accent disabled:opacity-60">ایجاد کاربر</button>
        {msg ? <p className="mt-3 text-xs font-bold text-app-ok">{msg}</p> : null}
        {error ? <p className="mt-3 text-xs font-bold text-app-err">{error}</p> : null}
      </form>

      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">نام</th><th className="px-4 py-3">ایمیل</th><th className="px-4 py-3">نقش</th>
              <th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">آخرین ورود</th><th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-bold">{u.name ?? "—"}</td>
                <td className="px-4 py-3 text-xs" dir="ltr">{u.email ?? "—"}</td>
                <td className="px-4 py-3">{ROLE_FA[u.role] ?? u.role}</td>
                <td className="px-4 py-3">
                  <span className={u.status === "ACTIVE" ? "font-bold text-app-ok" : "font-bold text-app-err"}>
                    {u.status === "ACTIVE" ? "فعال" : "معلق"}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-ink/60">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString("fa-IR") : "—"}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleStatus(u)} className="text-xs font-bold text-primary">
                    {u.status === "ACTIVE" ? "معلق کردن" : "فعال کردن"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
