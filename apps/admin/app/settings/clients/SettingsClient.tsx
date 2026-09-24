"use client";

import { useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface ThemeSettings {
  primary: string;
  ink: string;
  bg: string;
  fontHeading: string;
  fontBody: string;
  storeName: string;
}

const DEFAULT_THEME: ThemeSettings = {
  primary: "#A67DEA",
  ink: "#1f1a2e",
  bg: "#faf7f2",
  fontHeading: "Vazirmatn",
  fontBody: "Vazirmatn",
  storeName: "لباس زیر قاصدک",
};

const FONT_OPTIONS = [
  { value: "Vazirmatn", label: "وزیرمتن" },
  { value: "IRANSans", label: "ایران‌سنس" },
  { value: "Yekan Bakh", label: "یکان‌بخ" },
  { value: "Estedad", label: "استعداد" },
  { value: "Sahel", label: "ساحل" },
];

/** تنظیمات — تم ظاهری (رنگ/فونت/نام فروشگاه) + تنظیمات سیستم (بند ۵۰) */
export default function SettingsClient() {
  const { call, loading } = useAdminApi();
  const [theme, setTheme] = useState<ThemeSettings>(DEFAULT_THEME);
  const [maintenance, setMaintenance] = useState(false);
  const [motion, setMotion] = useState({ enabled: true, intensity: "subtle" });
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await call<Record<string, unknown>>("/admin/settings");
      if (r.ok && r.data) {
        if (r.data["theme"]) setTheme({ ...DEFAULT_THEME, ...(r.data["theme"] as ThemeSettings) });
        if (r.data["maintenance"]) setMaintenance(Boolean((r.data["maintenance"] as { enabled?: boolean }).enabled));
        if (r.data["motion"]) setMotion({ enabled: (r.data["motion"] as { enabled?: boolean }).enabled !== false, intensity: (r.data["motion"] as { intensity?: string }).intensity ?? "subtle" });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveTheme = async () => {
    setError(null); setMsg(null);
    const r = await call("/admin/settings", { method: "POST", body: JSON.stringify({ key: "theme", value: theme }) });
    if (r.ok) setMsg("تم ذخیره شد ✅ — در فروشگاه اعمال می‌شود."); else setError(r.error?.message ?? "خطا");
  };

  const saveMaintenance = async (enabled: boolean) => {
    setMaintenance(enabled);
    const r = await call("/admin/settings", { method: "POST", body: JSON.stringify({ key: "maintenance", value: { enabled } }) });
    if (r.ok) setMsg(enabled ? "حالت تعمیر فعال شد." : "حالت تعمیر خاموش شد."); else setError(r.error?.message ?? "خطا");
  };

  const saveMotion = async () => {
    setError(null); setMsg(null);
    const r = await call("/admin/settings", { method: "POST", body: JSON.stringify({ key: "motion", value: motion }) });
    if (r.ok) setMsg("تنظیمات موشن ذخیره شد ✅"); else setError(r.error?.message ?? "خطا");
  };

  const presets = [
    { name: "بنفش قاصدک", primary: "#A67DEA", ink: "#1f1a2e", bg: "#faf7f2" },
    { name: "صورتی گلبهی", primary: "#E5799A", ink: "#2d1f26", bg: "#fdf6f4" },
    { name: "زرشکی لاکچری", primary: "#9E3B54", ink: "#2a1a1f", bg: "#fbf5f4" },
    { name: "نیلی مدرن", primary: "#5B6FE6", ink: "#181c2e", bg: "#f5f6fb" },
    { name: "زمردی آرام", primary: "#2E9E83", ink: "#16261f", bg: "#f3faf7" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {msg ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}

      {/* تم ظاهری */}
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-black text-ink">🎨 ظاهر سایت (تم)</h2>
        <p className="mt-1 text-xs text-ink/50">رنگ‌ها و فونت‌ها بلافاصله روی فروشگاه اعمال می‌شوند — بدون تغییر کد.</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button key={p.name} onClick={() => setTheme({ ...theme, primary: p.primary, ink: p.ink, bg: p.bg })}
              className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-bold hover:border-primary">
              <span className="h-4 w-4 rounded-full" style={{ background: p.primary }} />
              {p.name}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <label className="text-xs font-bold text-ink/70">رنگ اصلی
            <div className="mt-1 flex items-center gap-2">
              <input type="color" value={theme.primary} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border border-line" />
              <input value={theme.primary} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} dir="ltr" className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
            </div>
          </label>
          <label className="text-xs font-bold text-ink/70">رنگ متن
            <div className="mt-1 flex items-center gap-2">
              <input type="color" value={theme.ink} onChange={(e) => setTheme({ ...theme, ink: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border border-line" />
              <input value={theme.ink} onChange={(e) => setTheme({ ...theme, ink: e.target.value })} dir="ltr" className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
            </div>
          </label>
          <label className="text-xs font-bold text-ink/70">رنگ پس‌زمینه
            <div className="mt-1 flex items-center gap-2">
              <input type="color" value={theme.bg} onChange={(e) => setTheme({ ...theme, bg: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border border-line" />
              <input value={theme.bg} onChange={(e) => setTheme({ ...theme, bg: e.target.value })} dir="ltr" className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
            </div>
          </label>
          <label className="text-xs font-bold text-ink/70">فونت تیترها
            <select value={theme.fontHeading} onChange={(e) => setTheme({ ...theme, fontHeading: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-ink/70">فونت متن
            <select value={theme.fontBody} onChange={(e) => setTheme({ ...theme, fontBody: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-bold text-ink/70">نام فروشگاه
            <input value={theme.storeName} onChange={(e) => setTheme({ ...theme, storeName: e.target.value })} className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm" />
          </label>
        </div>

        {/* پیش‌نمایش زنده */}
        <div className="mt-4 rounded-xl p-4" style={{ background: theme.bg, color: theme.ink, fontFamily: theme.fontBody }}>
          <p className="text-lg font-black" style={{ fontFamily: theme.fontHeading, color: theme.primary }}>{theme.storeName}</p>
          <button className="mt-2 rounded-full px-4 py-1.5 text-xs font-black text-on-accent" style={{ background: theme.primary }}>دکمه نمونه</button>
        </div>

        <button onClick={saveTheme} disabled={loading} className="mt-4 h-10 rounded-full bg-primary px-6 text-sm font-black text-on-accent disabled:opacity-60">ذخیره تم</button>
      </div>

      {/* موشن لندینگ */}
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-black text-ink">🎞️ موشن صفحه اصلی</h2>
        <p className="mt-1 text-xs text-ink/60">میزان حرکت بلوک‌ها هنگام اسکرول را تنظیم کنید — کم و ملایم توصیه می‌شود.</p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-bold text-ink/80">
            <input type="checkbox" checked={motion.enabled} onChange={(e) => setMotion({ ...motion, enabled: e.target.checked })} />
            موشن فعال باشد
          </label>
          <label className="text-xs font-bold text-ink/70">شدت
            <select value={motion.intensity} onChange={(e) => setMotion({ ...motion, intensity: e.target.value })} className="ms-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
              <option value="subtle">ملایم (پیشنهادی)</option>
              <option value="playful">برجسته</option>
            </select>
          </label>
          <button onClick={saveMotion} disabled={loading} className="h-10 rounded-full bg-primary px-6 text-sm font-black text-on-accent disabled:opacity-60">ذخیره موشن</button>
        </div>
      </div>

      {/* سیستم */}
      <div className="rounded-card border border-line bg-surface p-5">
        <h2 className="text-sm font-black text-ink">⚙️ سیستم</h2>
        <label className="mt-3 flex items-center gap-2 text-sm font-bold text-ink/80">
          <input type="checkbox" checked={maintenance} onChange={(e) => saveMaintenance(e.target.checked)} />
          حالت تعمیر فروشگاه (checkout و مرور محصول بسته می‌شود)
        </label>
      </div>
    </div>
  );
}
