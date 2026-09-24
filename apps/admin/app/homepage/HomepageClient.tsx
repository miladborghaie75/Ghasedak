"use client";

import { useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface Section {
  id: string; type: string; config: Record<string, unknown>;
  sortOrder: number; enabled: boolean; publishStatus: string;
}

const TYPE_LABELS: Record<string, string> = {
  HERO: "هیرو", PRODUCT_CAROUSEL: "کاروسل محصول", PRODUCT_GRID: "شبکه محصول",
  CATEGORY_GRID: "شبکه دسته‌ها", BRAND_GRID: "شبکه برندها", BANNER: "بنر",
  GUIDE_CARDS: "کارت راهنما", TRUST_CARDS: "کارت اعتماد", NEED_FINDER: "چی لازم داری؟",
  RICH_TEXT: "متن", NEWSLETTER: "خبرنامه", IMAGE_TEXT: "عکس + متن",
};

const CONFIG_FIELDS: Array<{ key: string; label: string; type?: string }> = [
  { key: "title", label: "عنوان" },
  { key: "subtitle", label: "زیرعنوان" },
  { key: "imageUrl", label: "آدرس تصویر" },
  { key: "ctaLabel", label: "متن دکمه" },
  { key: "ctaHref", label: "لینک دکمه" },
  { key: "categorySlug", label: "شناسه دسته" },
  { key: "text", label: "متن", type: "textarea" },
];

/** صفحه‌ساز — ترتیب بلوک‌های صفحه اصلی؛ ذخیره در HomeSection و رندر واقعی در فرانت */
export default function HomepageClient() {
  const { call, loading } = useAdminApi();
  const [items, setItems] = useState<Section[]>([]);
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("BANNER");

  const load = async () => {
    const r = await call<{ items: Section[] }>("/admin/capabilities/home-sections");
    if (r.ok && r.data) setItems(r.data.items);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const update = async (id: string, data: Record<string, unknown>) => {
    const r = await call(`/admin/capabilities/home-sections/${id}`, { method: "POST", body: JSON.stringify(data) });
    setMsg(r.ok ? "ذخیره شد ✅" : r.error?.message ?? "خطا");
    setTimeout(() => setMsg(""), 2000);
    if (r.ok) await load();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const arr = [...items];
    const target = idx + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[idx], arr[target]] = [arr[target], arr[idx]];
    // ترتیب جدید ذخیره می‌شود
    await Promise.all(arr.map((s, i) => call(`/admin/capabilities/home-sections/${s.id}`, { method: "POST", body: JSON.stringify({ sortOrder: i }) })));
    await load();
  };

  const add = async () => {
    const r = await call("/admin/capabilities/home-sections", {
      method: "POST",
      body: JSON.stringify({ type: newType, config: { title: "عنوان بخش" }, sortOrder: items.length }),
    });
    setMsg(r.ok ? "بخش اضافه شد ✅" : r.error?.message ?? "خطا");
    if (r.ok) { setAdding(false); await load(); }
  };

  const remove = async (id: string) => {
    const r = await call(`/admin/capabilities/home-sections/${id}`, { method: "DELETE" });
    if (r.ok) await load();
  };

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-card border border-line bg-surface px-4 py-2 text-sm">{msg}</div>}

      <p className="text-xs leading-6 text-muted">
        ترتیب و محتوای بلوک‌های صفحه اصلی فروشگاه از همین‌جا کنترل می‌شود؛ بعد از ذخیره، صفحه اصلی سایت واقعاً همان ترتیب را نشان می‌دهد.
      </p>

      <div className="space-y-3">
        {items.map((s, idx) => (
          <div key={s.id} className="rounded-card border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-primary-tint px-3 py-1 text-xs font-bold text-primary-strong">{TYPE_LABELS[s.type] ?? s.type}</span>
              <span className="text-[11px] text-muted">#{s.sortOrder + 1}</span>
              <div className="flex gap-1">
                <button onClick={() => void move(idx, -1)} className="rounded border border-line px-2 py-0.5 text-xs" title="بالا">↑</button>
                <button onClick={() => void move(idx, 1)} className="rounded border border-line px-2 py-0.5 text-xs" title="پایین">↓</button>
              </div>
              <button onClick={() => void update(s.id, { enabled: !s.enabled })}
                className={`rounded-full px-3 py-1 text-[11px] font-bold ${s.enabled ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                {s.enabled ? "فعال" : "خاموش"}
              </button>
              <button onClick={() => void update(s.id, { publishStatus: s.publishStatus === "PUBLISHED" ? "DRAFT" : "PUBLISHED" })}
                className={`rounded-full px-3 py-1 text-[11px] font-bold ${s.publishStatus === "PUBLISHED" ? "bg-primary-tint text-primary-strong" : "bg-amber-100 text-amber-700"}`}>
                {s.publishStatus === "PUBLISHED" ? "منتشر شده" : "پیش‌نویس"}
              </button>
              <button onClick={() => void remove(s.id)} className="ms-auto text-[11px] font-bold text-red-500">حذف</button>
            </div>

            {/* ویرایش فیلدهای config */}
            <div className="mt-3 grid grid-cols-1 gap-2 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-3">
              {CONFIG_FIELDS.map((f) => {
                const val = (s.config[f.key] as string | undefined) ?? "";
                const isRelevant =
                  (f.key === "imageUrl" && (s.type === "HERO" || s.type === "BANNER" || s.type === "IMAGE_TEXT")) ||
                  (f.key === "text" && (s.type === "RICH_TEXT" || s.type === "IMAGE_TEXT")) ||
                  !["imageUrl", "text", "categorySlug"].includes(f.key);
                if (!isRelevant) return null;
                return (
                  <label key={f.key} className="text-[11px] font-bold text-muted">
                    {f.label}
                    {f.type === "textarea" ? (
                      <textarea defaultValue={val} data-section={s.id} data-field={f.key}
                        className="mt-1 block w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm" rows={2} />
                    ) : (
                      <input defaultValue={val} data-section={s.id} data-field={f.key}
                        className="mt-1 block w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm" />
                    )}
                  </label>
                );
              })}
              <button
                onClick={() => {
                  const inputs = document.querySelectorAll<HTMLInputElement>(`[data-section="${s.id}"]`);
                  const config = { ...s.config };
                  inputs.forEach((inp) => { if (inp.value) config[inp.dataset.field!] = inp.value; });
                  void update(s.id, { config });
                }}
                disabled={loading}
                className="self-end rounded-full bg-primary px-4 py-2 text-[11px] font-bold text-white"
              >
                ذخیره محتوا
              </button>
            </div>
          </div>
        ))}
        {items.length === 0 && <p className="py-6 text-center text-sm text-muted">هنوز سکشنی تعریف نشده — صفحه اصلی از چیدمان پیش‌فرض استفاده می‌کند.</p>}
      </div>

      {!adding ? (
        <button onClick={() => setAdding(true)} className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-bold">
          + افزودن بلوک جدید
        </button>
      ) : (
        <div className="flex items-center gap-2 rounded-card border border-line bg-surface p-4">
          <select value={newType} onChange={(e) => setNewType(e.target.value)} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={() => void add()} disabled={loading} className="rounded-full bg-primary px-4 py-2 text-xs font-bold text-white">افزودن</button>
          <button onClick={() => setAdding(false)} className="text-xs text-muted">انصراف</button>
        </div>
      )}
    </div>
  );
}
