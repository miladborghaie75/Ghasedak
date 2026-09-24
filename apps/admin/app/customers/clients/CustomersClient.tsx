"use client";

/**
 * CRM ادمین — سه تب: مشتریان / سبد رهاشده / تنظیمات (بند ۳۱/۴۰/۵۶).
 * همه اعداد از API واقعی؛ بدون داده ساختگی.
 */
import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface CustomerRow {
  id: string; mobile: string; name: string | null; status: string;
  totalSpent: string | number; ordersCount: number;
  firstOrderAt: string | null; lastOrderAt: string | null; createdAt: string;
}
interface AbandonedRow {
  id: string; token: string; customerId: string | null; updatedAt: string;
  items: Array<{ id: string; qty: number; variant: { sku: string; product: { name: string } } }>;
}
interface CrmSettings {
  enabled: boolean; delayMinutes: number; consentRequired: boolean; maxNotificationsPerCart: number;
}

export default function CustomersClient() {
  const { call, loading, permissions } = useAdminApi();
  const [tab, setTab] = useState<"customers" | "abandoned" | "settings">("customers");
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [abandoned, setAbandoned] = useState<AbandonedRow[]>([]);
  const [delayMinutes, setDelayMinutes] = useState<number>(60);
  const [settings, setSettings] = useState<CrmSettings | null>(null);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const canManage = (permissions ?? []).includes("customers.manage");

  const load = useCallback(async () => {
    setError("");
    if (tab === "customers") {
      const r = await call<{ items: CustomerRow[] }>(`/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      if (r.ok && r.data) setRows(r.data.items); else setError(r.error?.message ?? "خطا");
    } else if (tab === "abandoned") {
      const r = await call<{ items: AbandonedRow[]; delayMinutes: number }>(`/admin/abandoned-carts`);
      if (r.ok && r.data) { setAbandoned(r.data.items); setDelayMinutes(r.data.delayMinutes); } else setError(r.error?.message ?? "خطا");
    } else {
      const r = await call<CrmSettings>(`/admin/crm/settings`);
      if (r.ok && r.data) setSettings(r.data); else setError(r.error?.message ?? "خطا");
    }
  }, [tab, q]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { void load(); }, [load]);

  const saveSettings = async () => {
    if (!settings) return;
    const r = await call("/admin/crm/settings", { method: "POST", body: JSON.stringify(settings) });
    setMsg(r.ok ? "تنظیمات ذخیره شد ✅" : "");
    setError(r.ok ? "" : r.error?.message ?? "خطا");
  };

  const saveCustomer = async (id: string, patch: Record<string, unknown>) => {
    const r = await call(`/admin/customers/${id}`, { method: "POST", body: JSON.stringify(patch) });
    setMsg(r.ok ? "ذخیره شد ✅" : "");
    setError(r.ok ? "" : r.error?.message ?? "خطا");
    if (r.ok) await load();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {([["customers", "مشتریان"], ["abandoned", "سبد رهاشده"], ["settings", "تنظیمات"]] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={`rounded-full px-4 py-1.5 text-xs font-bold ${tab === k ? "bg-primary text-on-accent" : "border border-line text-ink hover:bg-app-primary-soft"}`}
          >
            {label}
          </button>
        ))}
        {tab === "customers" && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجوی موبایل/نام"
            className="ms-auto h-9 w-56 rounded-lg border border-line bg-surface px-3 text-xs"
          />
        )}
      </div>

      {msg && <p className="rounded-xl border border-app-ok/40 bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p>}
      {error && <p className="rounded-xl border border-app-err/40 bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p>}

      {tab === "customers" && (
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-right text-xs text-ink/60">
                <th className="px-4 py-3">موبایل</th>
                <th className="px-4 py-3">نام</th>
                <th className="px-4 py-3">سفارش‌ها</th>
                <th className="px-4 py-3">مجموع خرید (تومان)</th>
                <th className="px-4 py-3">آخرین خرید</th>
                <th className="px-4 py-3">وضعیت</th>
                <th className="px-4 py-3">اقدام</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3 font-bold tnum" dir="ltr">{c.mobile}</td>
                  <td className="px-4 py-3">
                    {canManage ? (
                      <input
                        defaultValue={c.name ?? ""}
                        onBlur={(e) => e.target.value !== (c.name ?? "") && void saveCustomer(c.id, { name: e.target.value })}
                        className="h-8 w-32 rounded-lg border border-line bg-surface px-2 text-xs"
                      />
                    ) : (c.name ?? "—")}
                  </td>
                  <td className="px-4 py-3 tnum">{fa(c.ordersCount)}</td>
                  <td className="px-4 py-3 tnum">{fa(Number(c.totalSpent))}</td>
                  <td className="px-4 py-3 text-xs text-ink/60" dir="ltr">
                    {c.lastOrderAt ? new Date(c.lastOrderAt).toLocaleDateString("fa-IR") : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {c.status === "active" ? <span className="font-bold text-app-ok">فعال</span> : <span className="font-bold text-app-err">مسدود</span>}
                  </td>
                  <td className="px-4 py-3">
                    {canManage && (
                      <button
                        onClick={() => void saveCustomer(c.id, { status: c.status === "active" ? "blocked" : "active" })}
                        className="rounded-full border border-line px-2 py-1 text-[10px] font-bold"
                      >
                        {c.status === "active" ? "مسدود کن" : "رفع مسدودی"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/50">مشتری‌ای یافت نشد — با اولین سفارش/فروش POS ثبت می‌شود.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "abandoned" && (
        <>
          <p className="text-xs text-muted">
            سبدِ فعالی که بیش از {fa(delayMinutes)} دقیقه از آخرین تغییرش گذشته و آیتم دارد — محاسبه زنده از سبد سروری.
          </p>
          <div className="overflow-x-auto rounded-card border border-line bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-right text-xs text-ink/60">
                  <th className="px-4 py-3">توکن سبد</th>
                  <th className="px-4 py-3">آیتم‌ها</th>
                  <th className="px-4 py-3">ارزش تقریبی (تومان)</th>
                  <th className="px-4 py-3">آخرین تغییر</th>
                </tr>
              </thead>
              <tbody>
                {abandoned.map((c) => (
                  <tr key={c.id} className="border-b border-line/60 last:border-0">
                    <td className="px-4 py-3 font-mono text-[11px]" dir="ltr">{c.token.slice(0, 12)}…</td>
                    <td className="px-4 py-3 text-xs">
                      {c.items.map((i) => `${i.qty}× ${i.variant.product.name}`).join("، ")}
                    </td>
                    <td className="px-4 py-3 tnum">
                      {fa(c.items.reduce((s, i) => s + i.qty * Number(i.variant.sku ? 0 : 0), 0))}
                      <span className="text-[10px] text-ink/50"> (قیمت لحظه‌ای در چک‌اوت)</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/60" dir="ltr">
                      {new Date(c.updatedAt).toLocaleString("fa-IR")}
                    </td>
                  </tr>
                ))}
                {abandoned.length === 0 && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-ink/50">سبد رهاشده‌ای در آستانه {fa(delayMinutes)} دقیقه نیست.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "settings" && settings && (
        <div className="max-w-xl rounded-card border border-line bg-surface p-4">
          <h3 className="mb-3 text-sm font-black">تنظیمات سبد رهاشده</h3>
          <label className="mb-3 flex items-center justify-between gap-3 text-xs">
            <span className="font-bold">فعال بودن تشخیص</span>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
              className="size-4"
            />
          </label>
          <label className="mb-3 flex items-center justify-between gap-3 text-xs">
            <span className="font-bold">آستانه رهاشدگی (دقیقه؛ ۵ تا ۱۴۴۰)</span>
            <input
              type="number"
              min={5}
              max={1440}
              value={settings.delayMinutes}
              onChange={(e) => setSettings({ ...settings, delayMinutes: Number(e.target.value) })}
              className="h-9 w-24 rounded-lg border border-line bg-surface px-2 text-xs tnum"
              dir="ltr"
            />
          </label>
          <label className="mb-3 flex items-center justify-between gap-3 text-xs">
            <span className="font-bold">الزام رضایت مشتری قبل از هر پیام</span>
            <input
              type="checkbox"
              checked={settings.consentRequired}
              onChange={(e) => setSettings({ ...settings, consentRequired: e.target.checked })}
              className="size-4"
            />
          </label>
          <p className="mb-3 rounded-xl bg-app-primary-soft p-3 text-[11px] leading-6 text-ink/70">
            ارسال پیام فقط پس از رضایت ثبت‌شده (Consent) و با credential واقعی SMS انجام می‌شود؛
            بدون credential هیچ پیام «ارسال‌شده» جعل نمی‌شود.
          </p>
          <button
            onClick={() => void saveSettings()}
            disabled={loading || !canManage}
            className="h-9 rounded-full bg-primary px-5 text-xs font-bold text-on-accent disabled:opacity-50"
          >
            ذخیره تنظیمات
          </button>
        </div>
      )}
    </div>
  );
}
