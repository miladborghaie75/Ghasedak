"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadMedia, useAdminApi } from "@/components/useAdminApi";

/**
 * کتابخانهٔ رسانه به‌صورت دیالوگ — هرجا در پنل لازم باشد باز می‌شود.
 *
 * چرا دیالوگ و نه رفتن به صفحهٔ «رسانه»: مدیر وسط کار نباید صفحه را از
 * دست بدهد. انتخاب یا آپلود، برگشت به همان فرم با همان مقدار ذخیره‌شده.
 *
 * سه کار در یک جا:
 *  ۱) جست‌وجو و انتخاب از تصاویر موجود
 *  ۲) آپلود تصویر تازه (بدون رفتن به صفحهٔ دیگر)
 *  ۳) تنظیم متن جایگزین و عنوان سئو در همان لحظهٔ آپلود — چون بعداً
 *     فراموش می‌شود و متن جایگزین نوشته‌نشده یعنی تصویر غیرقابل‌دسترس
 */

export interface PickedMedia {
  id: string;
  storageKey: string;
  url: string;
  alt: string | null;
  title: string | null;
}

interface MediaRow {
  id: string;
  storageKey: string;
  kind: string;
  mime: string;
  sizeBytes: number;
  alt: string | null;
  title: string | null;
  width: number | null;
  height: number | null;
  url: string;
}

function kb(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function MediaLibraryDialog({
  open,
  onClose,
  onPick,
  title = "انتخاب تصویر",
}: {
  open: boolean;
  onClose: () => void;
  onPick: (m: PickedMedia) => void;
  title?: string;
}) {
  const { call } = useAdminApi();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"library" | "upload">("library");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // فرم آپلود — سئو همین‌جا و در همان لحظه پرسیده می‌شود
  const [file, setFile] = useState<File | null>(null);
  const [alt, setAlt] = useState("");
  const [seoTitle, setSeoTitle] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const r = await call<{ items: MediaRow[] }>("/admin/capabilities/media");
    if (r.ok && r.data) setItems((r.data.items ?? []).filter((m) => m.mime.startsWith("image/")));
  }, [call]);

  useEffect(() => {
    if (open) {
      setErr(null);
      void load();
    }
  }, [open, load]);

  if (!open) return null;

  const list = q.trim()
    ? items.filter((m) => m.storageKey.toLowerCase().includes(q.trim().toLowerCase()))
    : items;

  const upload = async () => {
    if (!file) {
      setErr("اول یک فایل انتخاب کن.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const r = await uploadMedia(file, call, {
        // alt و title در همان آپلود ذخیره می‌شوند — بعداً یادآوری نمی‌شود
        alt: alt.trim() || null,
        title: seoTitle.trim() || null,
      });
      if (!r.ok || !r.id) {
        setErr(r.error ?? "آپلود ناموفق");
        return;
      }
      const key = r.storageKey ?? file.name;
      const created: PickedMedia = {
        id: r.id,
        storageKey: key,
        // مسیر رسانه در پنل ادمین از rewrite خود Next می‌آید (/api/media → API)
        url: r.url ?? `/api/media/${key}`,
        alt: alt.trim() || null,
        title: seoTitle.trim() || null,
      };
      onPick(created);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "آپلود ناموفق");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="mt-6 flex max-h-[86vh] w-full max-w-3xl flex-col overflow-hidden rounded-card border border-line bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* سربرگ */}
        <header className="flex shrink-0 items-center gap-2 border-b border-line p-3">
          <h2 className="text-sm font-black text-ink">{title}</h2>
          <div className="ms-auto flex gap-1">
            <button
              onClick={() => setTab("library")}
              className={`h-8 rounded-xl px-3 text-[11px] font-bold ${
                tab === "library" ? "bg-primary text-on-accent" : "border border-line text-ink/70"
              }`}
            >
              کتابخانه
            </button>
            <button
              onClick={() => setTab("upload")}
              className={`h-8 rounded-xl px-3 text-[11px] font-bold ${
                tab === "upload" ? "bg-primary text-on-accent" : "border border-line text-ink/70"
              }`}
            >
              آپلود تازه
            </button>
          </div>
          <button onClick={onClose} aria-label="بستن" className="h-8 w-8 rounded-full border border-line text-xs font-bold">
            ✕
          </button>
        </header>

        {/* بدنه */}
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {err && <p className="mb-2 rounded-xl bg-app-bg px-3 py-2 text-[11px] font-bold text-app-err">{err}</p>}

          {tab === "library" ? (
            <>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="جست‌وجوی نام فایل…"
                className="mb-2 w-full rounded-xl border border-line bg-app-bg px-3 py-2 text-[12px]"
              />
              {list.length === 0 ? (
                <div className="py-10 text-center">
                  <p className="text-[12px] text-ink/60">تصویری پیدا نشد.</p>
                  <button
                    onClick={() => setTab("upload")}
                    className="mt-2 h-9 rounded-full bg-primary px-5 text-[12px] font-black text-on-accent"
                  >
                    آپلود اولین تصویر
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {list.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => {
                        onPick({ id: m.id, storageKey: m.storageKey, url: m.url, alt: m.alt, title: m.title });
                        onClose();
                      }}
                      title={`${m.storageKey}\n${m.width ?? "?"}×${m.height ?? "?"} — ${kb(m.sizeBytes)}`}
                      className="group overflow-hidden rounded-xl border border-line bg-app-bg text-start transition-all hover:border-primary-soft hover:shadow-app-shadow-1"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.url} alt={m.alt ?? ""} className="aspect-square w-full object-cover" />
                      <span className="block truncate px-2 py-1 text-[9px] text-ink/50">{m.storageKey}</span>
                      {!m.alt && <span className="block px-2 pb-1 text-[9px] font-bold text-app-warning">بدون متن جایگزین</span>}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="space-y-3">
              {/* انتخاب فایل */}
              <div className="rounded-xl border border-dashed border-line bg-app-bg p-4 text-center">
                {file ? (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={URL.createObjectURL(file)} alt="" className="mx-auto max-h-40 rounded-lg object-contain" />
                    <p className="mt-2 text-[11px] text-ink/60">
                      {file.name} — {kb(file.size)}
                    </p>
                  </>
                ) : (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="text-[12px] font-bold text-primary-strong"
                  >
                    انتخاب فایل از کامپیوتر…
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setFile(f);
                    // اگر نام فایل خوانا بود، پیشنهاد اولیهٔ متن جایگزین
                    if (f && !alt) setAlt(f.name.replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " "));
                  }}
                />
              </div>

              {/* سئو تصویر — همان لحظهٔ آپلود */}
              <div className="rounded-xl border border-line p-3">
                <p className="text-[11px] font-black text-ink">تنظیمات سئو تصویر</p>
                <p className="mt-0.5 text-[10px] leading-5 text-ink/50">
                  اگر تصویر نمایندهٔ یک دسته یا برند است، متن جایگزین همان نام فارسی باشد — برای
                  صفحه‌خوان و موتور جست‌وجو.
                </p>

                <label className="mt-2 block text-[11px] font-bold text-ink/70">
                  متن جایگزین (alt)
                  <input
                    value={alt}
                    onChange={(e) => setAlt(e.target.value)}
                    placeholder="مثلاً: تیشرت نخی مردانه"
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px]"
                  />
                </label>

                <label className="mt-2 block text-[11px] font-bold text-ink/70">
                  عنوان سئو (title)
                  <input
                    value={seoTitle}
                    onChange={(e) => setSeoTitle(e.target.value)}
                    placeholder="اختیاری — برای داده‌های ساختاریافته"
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[11px]"
                  />
                </label>
              </div>

              <button
                onClick={() => void upload()}
                disabled={busy || !file}
                className="h-10 w-full rounded-full bg-primary text-xs font-black text-on-accent disabled:opacity-40"
              >
                {busy ? "در حال آپلود…" : "آپلود و انتخاب"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * دکمهٔ «انتخاب تصویر» — هرجا در پنل می‌خواهی تصویر بگذاری، این را می‌گذاری.
 * خودش دیالوگ کتابخانه را باز می‌کند.
 */
export function ImagePickerButton({
  value,
  onChange,
  label = "انتخاب تصویر",
  previewClass = "size-14",
}: {
  /** شناسهٔ رسانه (mediaId) یا خالی */
  value: string | null | undefined;
  onChange: (mediaId: string | null, meta?: { url: string; alt: string | null }) => void;
  label?: string;
  previewClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{ url: string; alt: string | null } | null>(null);
  const { call } = useAdminApi();

  // اگر مقدار از قبل هست، پیش‌نمایش را از کتابخانه می‌خوانیم
  useEffect(() => {
    if (!value) {
      setPreview(null);
      return;
    }
    if (preview) return;
    void (async () => {
      const r = await call<{ items: Array<{ id: string; url: string; alt: string | null }> }>(
        "/admin/capabilities/media",
      );
      if (r.ok && r.data) {
        const hit = (r.data.items ?? []).find((m) => m.id === value);
        if (hit) setPreview({ url: hit.url, alt: hit.alt });
      }
    })();
  }, [value, call, preview]);

  return (
    <>
      <div className="text-xs font-bold text-ink/70">
        <span>{label}</span>
        <div className="mt-1 flex items-center gap-2">
          <div
            className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line bg-surface ${previewClass}`}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.alt ?? ""} className="size-full object-cover" />
            ) : (
              <span className="text-[10px] text-ink/40">ندارد</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="h-10 flex-1 rounded-xl border border-line bg-surface px-3 text-[12px] font-bold hover:border-primary-soft"
          >
            {preview ? "تغییر تصویر" : label}
          </button>
          {value && (
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setPreview(null);
              }}
              title="حذف تصویر"
              className="h-10 shrink-0 rounded-xl border border-line px-3 text-[12px] font-bold text-app-err"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <MediaLibraryDialog
        open={open}
        onClose={() => setOpen(false)}
        onPick={(m) => {
          setPreview({ url: m.url, alt: m.alt });
          onChange(m.id, { url: m.url, alt: m.alt });
        }}
        title={label}
      />
    </>
  );
}
