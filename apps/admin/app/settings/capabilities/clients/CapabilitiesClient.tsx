"use client";

import { useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface CapabilityStatus {
  sms: { provider: string; credential: string; config: { sender?: string; orderNotify?: boolean } };
  payment: { zarinpal: string; mock: string; config: Record<string, unknown> };
  crm: { config: { abandonedCartHours?: number; followUpDays?: number; consentRequired?: boolean } };
  shipping: { config: { defaultCarrier?: string; freeOver?: number } };
  tax: { config: { rate?: number; enabled?: boolean } };
}

interface CredItem { configured: boolean; masked: string | null; source: string }
interface CredStatus { items: Record<string, CredItem> }
interface SmsProviderRow { id: string; name: string; envKey: string; docsUrl: string; configured: boolean; masked: string | null }
interface SmsProvidersStatus { providers: SmsProviderRow[]; active: string }

/** تنظیمات قابلیت‌ها — کلاینتِ صفحهٔ سرور (بند ۷/۴۵)؛ پیامک در یک کارت واحد */
export default function CapabilitiesClient() {
  const { call, loading } = useAdminApi();
  const [st, setSt] = useState<CapabilityStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [creds, setCreds] = useState<CredStatus | null>(null);
  const [credDraft, setCredDraft] = useState<Record<string, string>>({});
  const [smsProv, setSmsProv] = useState<SmsProvidersStatus | null>(null);
  const [smsTestMobile, setSmsTestMobile] = useState("");
  const [smsTestMsg, setSmsTestMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = async () => {
    const r = await call<CapabilityStatus>("/admin/capabilities/status");
    if (r.ok && r.data) setSt(r.data);
    const c = await call<CredStatus>("/admin/capabilities/credentials");
    if (c.ok && c.data) setCreds(c.data);
    const sp = await call<SmsProvidersStatus>("/admin/capabilities/sms/providers");
    if (sp.ok && sp.data) setSmsProv(sp.data);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (key: string, value: unknown) => {
    const r = await call(`/admin/capabilities/settings/${key}`, { method: "POST", body: JSON.stringify({ value }) });
    setMsg(r.ok ? "ذخیره شد ✅" : r.error?.message ?? "خطا");
    setTimeout(() => setMsg(""), 2500);
  };

  const saveCreds = async () => {
    const payload: Record<string, string> = {};
    for (const [k, v] of Object.entries(credDraft)) {
      if (v !== "" && v !== undefined) payload[k] = v; // فقط فیلدهای پرشده ارسال می‌شوند
    }
    if (Object.keys(payload).length === 0) { setMsg("چیزی برای ذخیره وارد نشده است."); return; }
    const r = await call<{ written: string[] }>("/admin/capabilities/credentials", { method: "POST", body: JSON.stringify(payload) });
    if (r.ok) {
      setCredDraft({});
      setMsg("کلیدها ذخیره شد ✅ — برای اعمال کامل، API را ری‌استارت کنید.");
      await load();
    } else {
      setMsg(r.error?.message ?? "خطا در ذخیرهٔ کلید");
    }
    setTimeout(() => setMsg(""), 6000);
  };

  const clearCred = async (key: string) => {
    const r = await call(`/admin/capabilities/credentials`, { method: "POST", body: JSON.stringify({ [key]: "" }) });
    setMsg(r.ok ? `${key} پاک شد.` : r.error?.message ?? "خطا");
    if (r.ok) await load();
    setTimeout(() => setMsg(""), 4000);
  };

  const pickSmsProvider = async (id: string) => {
    const r = await call<{ name: string }>("/admin/capabilities/sms/providers/active", { method: "POST", body: JSON.stringify({ provider: id }) });
    setMsg(r.ok ? `اپراتور فعال: ${r.data?.name ?? id} ✅` : r.error?.message ?? "خطا");
    if (r.ok) await load();
    setTimeout(() => setMsg(""), 4000);
  };

  const testSmsProvider = async (id: string) => {
    setSmsTestMsg(null);
    const r = await call<{ state?: string; error?: string }>("/admin/capabilities/sms/providers/test", { method: "POST", body: JSON.stringify({ provider: id, mobile: smsTestMobile }) });
    if (!r.ok) { setSmsTestMsg({ ok: false, text: r.error?.message ?? "خطا" }); return; }
    const state = r.data?.state;
    setSmsTestMsg({ ok: state === "SENT", text: state === "SENT" ? "پیام آزمایشی ارسال شد ✅" : state === "FAILED" ? (r.data?.error ?? "ارسال ناموفق") : (r.data?.error ?? "تنظیم نشده") });
  };

  if (!st) return <p className="p-6 text-sm text-muted">در حال بارگذاری…</p>;

  const credBadge = (s: string) =>
    s === "CONFIGURED" ? (
      <span className="rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-bold text-app-ok">پیکربندی شده</span>
    ) : s === "ACTIVE_DEV_ONLY" ? (
      <span className="rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-bold text-app-warning">فقط توسعه</span>
    ) : (
      <span className="rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-bold text-app-err">نیازمند credential</span>
    );

  return (
    <div className="space-y-6">
      {msg && <div className="rounded-card border border-line bg-surface px-4 py-2 text-sm">{msg}</div>}

      {/* پیامک — کارت واحد: اپراتور + کلید + تست (ادغام کارت قدیمی Kavenegar) */}
      <section className="rounded-card border border-line bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold text-ink">پیامک</h3>
          {credBadge(st.sms.credential)}
        </div>
        <p className="mb-3 text-xs leading-6 text-muted">
          شرکت ارسال‌کننده را انتخاب کنید؛ کلید API همان شرکت در جدول پایین (یا فایل محلی <code className="rounded bg-bg px-1">apps/api/.env.local</code> که هرگز در git نیست) ذخیره می‌شود و هیچ مقدار کامل در پنل نمایش داده نمی‌شود. پس از ذخیرهٔ کلید، API را ری‌استارت کنید.
        </p>
        {smsProv ? (
          <div className="space-y-2">
            {smsProv.providers.map((p) => (
              <div
                key={p.id}
                className={`flex flex-wrap items-center gap-3 rounded-card border p-3 ${smsProv.active === p.id ? "border-primary bg-primary/5" : "border-line bg-bg"}`}
              >
                <label className="flex flex-1 items-center gap-2 text-sm font-bold text-ink">
                  <input
                    type="radio"
                    name="sms-provider"
                    checked={smsProv.active === p.id}
                    onChange={() => void pickSmsProvider(p.id)}
                  />
                  {p.name}
                  <a href={p.docsUrl} target="_blank" rel="noreferrer" className="text-[10px] font-normal text-primary hover:underline" dir="ltr">مستندات ↗</a>
                </label>
                {p.configured ? (
                  <span className="rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-bold text-app-ok">کلید: {p.masked}</span>
                ) : (
                  <span className="rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-bold text-app-err">کلید وارد نشده ({p.envKey})</span>
                )}
                <input
                  value={smsTestMobile}
                  onChange={(e) => setSmsTestMobile(e.target.value)}
                  placeholder="۰۹… (تست)"
                  className="w-36 rounded-lg border border-line bg-surface px-2 py-1.5 text-xs"
                />
                <button onClick={() => void testSmsProvider(p.id)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold">
                  تست اتصال
                </button>
              </div>
            ))}
            {smsTestMsg ? (
              <p className={`text-xs font-bold ${smsTestMsg.ok ? "text-app-ok" : "text-app-err"}`}>{smsTestMsg.text}</p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted">در حال بارگذاری اپراتورها…</p>
        )}

        {/* تنظیمات فرستنده و اعلان سفارش — از کارت قدیمی منتقل شده */}
        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <label className="text-xs font-bold text-muted">
            شماره فرستنده
            <input
              defaultValue={st.sms.config.sender ?? ""}
              id="sms-sender"
              className="mt-1 block w-40 rounded-lg border border-line bg-bg px-3 py-2 text-sm text-ink"
              placeholder="مثلاً 10008000"
            />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-muted">
            <input type="checkbox" id="sms-notify" defaultChecked={st.sms.config.orderNotify !== false} />
            پیامک وضعیت سفارش فعال باشد
          </label>
          <button
            onClick={() => void save("sms", { sender: (document.getElementById("sms-sender") as HTMLInputElement)?.value, orderNotify: (document.getElementById("sms-notify") as HTMLInputElement)?.checked })}
            disabled={loading}
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-accent"
          >
            ذخیره
          </button>
        </div>
      </section>

      {/* کلیدهای API (credential) — بند ۴۵: هرگز در DB، هرگز در پاسخ کامل */}
      <section className="rounded-card border border-line bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold text-ink">کلیدهای API (credential)</h3>
        </div>
        <p className="mb-3 text-xs leading-6 text-muted">
          کلیدها در فایل محلی <code className="rounded bg-bg px-1">apps/api/.env.local</code> (خارج از git) نوشته می‌شوند و در دیتابیس ذخیره نمی‌گردند؛ هیچ مقدار کامل هرگز در پنل نمایش داده نمی‌شود. پس از ذخیره، API را ری‌استارت کنید.
        </p>
        {creds ? (
          <div className="overflow-x-auto rounded-card border border-line">
            <div className="admin-table-wrap"><table className="w-full text-xs">
              <thead className="bg-ink/5 text-muted"><tr><th className="px-3 py-2 text-start">کلید</th><th className="px-3 py-2 text-start">وضعیت</th><th className="px-3 py-2 text-start">مقدار فعلی (ماسک)</th><th className="px-3 py-2 text-start">مقدار جدید</th><th className="px-3 py-2"></th></tr></thead>
              <tbody>
                {Object.entries(creds.items).map(([k, it]) => (
                  <tr key={k} className="border-t border-line/60">
                    <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{k}</td>
                    <td className="px-3 py-2">
                      {it.configured
                        ? <span className="rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-bold text-app-ok">تنظیم شده ({it.source === "env" ? "env" : "فایل"})</span>
                        : <span className="rounded-full bg-app-primary-soft px-2 py-0.5 text-[11px] font-bold text-app-err">تنظیم نشده</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted" dir="ltr">{it.masked ?? "—"}</td>
                    <td className="px-3 py-2">
                      <input
                        type="password"
                        autoComplete="off"
                        value={credDraft[k] ?? ""}
                        onChange={(e) => setCredDraft((d) => ({ ...d, [k]: e.target.value }))}
                        placeholder={it.configured ? "(بدون تغییر اگر خالی بماند)" : "کلید را وارد کنید"}
                        className="w-56 rounded-lg border border-line bg-bg px-2 py-1.5 font-mono text-[11px]"
                        dir="ltr"
                      />
                    </td>
                    <td className="px-3 py-2">
                      {it.configured ? (
                        <button onClick={() => void clearCred(k)} className="rounded-lg border border-app-err/40 px-2 py-1 text-[11px] font-bold text-app-err">پاک‌کردن</button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        ) : (
          <p className="text-xs text-muted">در حال بارگذاری وضعیت کلیدها…</p>
        )}
        <button
          onClick={() => void saveCreds()}
          disabled={loading}
          className="mt-3 rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-accent disabled:opacity-40"
        >
          ذخیرهٔ کلیدهای واردشده
        </button>
      </section>

      {/* درگاه پرداخت */}
      <section className="rounded-card border border-line bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold text-ink">درگاه پرداخت</h3>
          {credBadge(st.payment.zarinpal)} {credBadge(st.payment.mock)}
        </div>
        <p className="mb-3 text-xs leading-6 text-muted">
          زرین‌پال با <code className="rounded bg-bg px-1">ZARINPAL_MERCHANT_ID</code> فعال می‌شود. درگاه آزمایشی فقط در محیط توسعه در دسترس است و هرگز در production بالا نمی‌آید.
        </p>
      </section>

      {/* CRM */}
      <section className="rounded-card border border-line bg-surface p-5">
        <h3 className="mb-3 font-display text-base font-bold text-ink">CRM و باشگاه مشتریان</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold text-muted">
            سبد رهاشده — یادآوری بعد از (ساعت)
            <input id="crm-hours" type="number" min={1} max={72} defaultValue={st.crm.config.abandonedCartHours ?? 24}
              className="mt-1 block w-24 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-bold text-muted">
            پیگیری پس از خرید (روز)
            <input id="crm-days" type="number" min={1} max={90} defaultValue={st.crm.config.followUpDays ?? 7}
              className="mt-1 block w-24 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-muted">
            <input type="checkbox" id="crm-consent" defaultChecked={st.crm.config.consentRequired !== false} />
            ارسال بازاریابی فقط با رضایت مشتری
          </label>
          <button
            onClick={() => void save("crm", {
              abandonedCartHours: Number((document.getElementById("crm-hours") as HTMLInputElement)?.value || 24),
              followUpDays: Number((document.getElementById("crm-days") as HTMLInputElement)?.value || 7),
              consentRequired: (document.getElementById("crm-consent") as HTMLInputElement)?.checked,
            })}
            disabled={loading}
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-accent"
          >
            ذخیره
          </button>
        </div>
      </section>

      {/* ارسال */}
      <section className="rounded-card border border-line bg-surface p-5">
        <h3 className="mb-3 font-display text-base font-bold text-ink">ارسال و لجستیک</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold text-muted">
            شرکت حمل پیش‌فرض
            <select id="ship-carrier" defaultValue={st.shipping.config.defaultCarrier ?? "post"}
              className="mt-1 block w-40 rounded-lg border border-line bg-bg px-3 py-2 text-sm">
              <option value="post">پست</option>
              <option value="tipax">تیپاکس</option>
              <option value="chapar">چاپار</option>
              <option value="pishtaz">پست پیشتاز</option>
            </select>
          </label>
          <label className="text-xs font-bold text-muted">
            ارسال رایگان بالای (تومان)
            <input id="ship-free" type="number" min={0} defaultValue={st.shipping.config.freeOver ?? 0}
              className="mt-1 block w-36 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
          </label>
          <button
            onClick={() => void save("shipping", {
              defaultCarrier: (document.getElementById("ship-carrier") as HTMLSelectElement)?.value,
              freeOver: Number((document.getElementById("ship-free") as HTMLInputElement)?.value || 0),
            })}
            disabled={loading}
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-accent"
          >
            ذخیره
          </button>
        </div>
      </section>

      {/* مالیات */}
      <section className="rounded-card border border-line bg-surface p-5">
        <h3 className="mb-3 font-display text-base font-bold text-ink">مالیات</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-bold text-muted">
            نرخ (درصد)
            <input id="tax-rate" type="number" min={0} max={25} defaultValue={st.tax.config.rate ?? 0}
              className="mt-1 block w-24 rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
          </label>
          <label className="flex items-center gap-2 text-xs font-bold text-muted">
            <input type="checkbox" id="tax-enabled" defaultChecked={st.tax.config.enabled === true} />
            اعمال مالیات در فاکتورها
          </label>
          <button
            onClick={() => void save("tax", {
              rate: Number((document.getElementById("tax-rate") as HTMLInputElement)?.value || 0),
              enabled: (document.getElementById("tax-enabled") as HTMLInputElement)?.checked,
            })}
            disabled={loading}
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-on-accent"
          >
            ذخیره
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">نرخ فعلی V1 برابر صفر است؛ محاسبه همیشه سمت سرور انجام می‌شود.</p>
      </section>
    </div>
  );
}
