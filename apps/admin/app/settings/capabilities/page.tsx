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

/** تنظیمات قابلیت‌ها — وضعیت credential واقعی؛ بدون پیام فیک (بند ۱۱۱) */
export default function CapabilitiesSettings() {
  const { call, loading } = useAdminApi();
  const [st, setSt] = useState<CapabilityStatus | null>(null);
  const [msg, setMsg] = useState("");
  const [testMobile, setTestMobile] = useState("");

  const load = async () => {
    const r = await call<CapabilityStatus>("/admin/capabilities/status");
    if (r.ok && r.data) setSt(r.data);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (key: string, value: unknown) => {
    const r = await call(`/admin/capabilities/settings/${key}`, { method: "POST", body: JSON.stringify({ value }) });
    setMsg(r.ok ? "ذخیره شد ✅" : r.error?.message ?? "خطا");
    setTimeout(() => setMsg(""), 2500);
  };

  const testSms = async () => {
    const r = await call<{ ok: boolean }>("/admin/capabilities/sms/test", { method: "POST", body: JSON.stringify({ mobile: testMobile }) });
    setMsg(r.ok ? "پیام آزمایشی ارسال شد ✅" : r.error?.message ?? "خطا");
    setTimeout(() => setMsg(""), 4000);
  };

  if (!st) return <p className="p-6 text-sm text-muted">در حال بارگذاری…</p>;

  const credBadge = (s: string) =>
    s === "CONFIGURED" ? (
      <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">پیکربندی شده</span>
    ) : s === "ACTIVE_DEV_ONLY" ? (
      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">فقط توسعه</span>
    ) : (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-bold text-red-700">نیازمند credential</span>
    );

  return (
    <div className="space-y-6">
      {msg && <div className="rounded-card border border-line bg-surface px-4 py-2 text-sm">{msg}</div>}

      {/* SMS */}
      <section className="rounded-card border border-line bg-surface p-5">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="font-display text-base font-bold text-ink">پیامک (Kavenegar)</h3>
          {credBadge(st.sms.credential)}
        </div>
        <p className="mb-3 text-xs leading-6 text-muted">
          کلید API فقط از متغیر محیطی <code className="rounded bg-bg px-1">KAVENEGAR_API_KEY</code> خوانده می‌شود و در دیتابیس ذخیره نمی‌گردد.
        </p>
        <div className="flex flex-wrap items-end gap-3">
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
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white"
          >
            ذخیره
          </button>
        </div>
        <div className="mt-3 flex items-end gap-2 border-t border-line pt-3">
          <input
            value={testMobile}
            onChange={(e) => setTestMobile(e.target.value)}
            placeholder="۰۹…"
            className="w-40 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
          />
          <button onClick={() => void testSms()} disabled={loading} className="rounded-full border border-line px-4 py-2 text-xs font-bold">
            ارسال پیام آزمایشی
          </button>
        </div>
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
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white"
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
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white"
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
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white"
          >
            ذخیره
          </button>
        </div>
        <p className="mt-2 text-[11px] text-muted">نرخ فعلی V1 برابر صفر است؛ محاسبه همیشه سمت سرور انجام می‌شود.</p>
      </section>
    </div>
  );
}
