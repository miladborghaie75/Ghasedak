"use client";

import { useEffect, useMemo, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface MediaRow {
  id: string; kind: string; mime: string; sizeBytes: number;
  alt: string | null; title: string | null; caption: string | null;
  createdAt: string; url: string;
}
interface MediaDetail extends MediaRow {
  storageKey: string; width: number | null; height: number | null;
  usage: { products: number; brands: number; categories: number; total: number };
}

const fa = (n: number | string) => Number(n).toLocaleString("fa-IR");
const faDate = (iso: string) => new Date(iso).toLocaleString("fa-IR");

/** حجم خوانا — فاز ۱۴ شکاف رسانه */
const humanSize = (b: number) => {
  if (b >= 1024 * 1024) return `${(b / (1024 * 1024)).toLocaleString("fa-IR", { maximumFractionDigits: 1 })} مگابایت`;
  if (b >= 1024) return `${(b / 1024).toLocaleString("fa-IR", { maximumFractionDigits: 0 })} کیلوبایت`;
  return `${fa(b)} بایت`;
};

const KIND_TABS: Array<{ kind: string; label: string; icon: string }> = [
  { kind: "image", label: "تصاویر", icon: "🖼️" },
  { kind: "video", label: "ویدیو", icon: "🎬" },
  { kind: "doc", label: "اسناد", icon: "📄" },
];

/** Media Library — آپلود/فیلتر نوع/دانلود/کپی لینک/جزئیات/جایگزینی/حذف (بند ۳۵/۱۱۰ + فاز ۱۴ شکاف رسانه) */
export default function MediaLibrary() {
  const { call, loading } = useAdminApi();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [altDraft, setAltDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [captionDraft, setCaptionDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [replaceFile, setReplaceFile] = useState<File | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const r = await call<{ items: MediaRow[] }>("/admin/capabilities/media");
    if (r.ok && r.data) setItems(r.data.items);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** فاز ۱۴: تب‌های فیلتر نوع — از دادهٔ واقعی، با شمارش */
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const m of items) c[m.kind] = (c[m.kind] ?? 0) + 1;
    return c;
  }, [items]);
  const visibleKinds = KIND_TABS.filter((t) => counts[t.kind] > 0);
  const filtered = filter === "all" ? items : items.filter((m) => m.kind === filter);

  const openDetail = async (id: string) => {
    setMsg("");
    setCopied(false);
    const r = await call<MediaDetail>(`/admin/capabilities/media/${id}`);
    if (r.ok && r.data) {
      setDetail(r.data);
      setAltDraft(r.data.alt ?? "");
      setTitleDraft(r.data.title ?? "");
      setCaptionDraft(r.data.caption ?? "");
      setReplaceFile(null);
      setConfirmDelete(false);
      setDetailOpen(true);
    } else {
      setMsg(r.error?.message ?? "خطا در دریافت جزئیات");
    }
  };

  const fileToBase64 = async (file: File) => {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };

  const onFile = async (file: File) => {
    setUploading(true);
    setMsg("");
    try {
      const dataBase64 = await fileToBase64(file);
      const r = await call<{ id: string }>("/admin/capabilities/media", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime: file.type, dataBase64, alt: file.name }),
      });
      setMsg(r.ok ? "آپلود شد ✅" : r.error?.message ?? "خطا در آپلود");
      if (r.ok) await load();
    } catch {
      setMsg("خواندن فایل ناموفق بود.");
    } finally {
      setUploading(false);
    }
  };

  const saveMeta = async () => {
    if (!detail) return;
    setBusy(true);
    const r = await call(`/admin/capabilities/media/${detail.id}`, {
      method: "PATCH",
      body: JSON.stringify({ alt: altDraft, title: titleDraft, caption: captionDraft }),
    });
    setBusy(false);
    setMsg(r.ok ? "ذخیره شد ✅" : r.error?.message ?? "خطا در ذخیره");
    if (r.ok) await load();
  };

  /** فاز ۱۴: دانلود مستقیم — endpoint با Content-Disposition: attachment */
  const downloadUrl = detail ? `/api/admin/capabilities/media/${detail.id}/download` : "#";

  /** فاز ۱۴: کپی لینک عمومی (آدرس مطلق از سرور) */
  const copyLink = async () => {
    if (!detail) return;
    const r = await call<{ absolute: string; url: string }>(`/admin/capabilities/media/${detail.id}/link`);
    if (r.ok && r.data) {
      const text = r.data.absolute || r.data.url;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // fallback مرورگرهای قدیمی
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      setCopied(true);
      setMsg("لینک کپی شد ✅");
    } else {
      setMsg(r.error?.message ?? "خطا در گرفتن لینک");
    }
  };

  const doReplace = async () => {
    if (!detail || !replaceFile) return;
    setBusy(true);
    try {
      const dataBase64 = await fileToBase64(replaceFile);
      const r = await call<{ url: string }>(`/admin/capabilities/media/${detail.id}/replace`, {
        method: "POST",
        body: JSON.stringify({ filename: replaceFile.name, mime: replaceFile.type, dataBase64 }),
      });
      setMsg(r.ok ? "فایل جایگزین شد ✅" : r.error?.message ?? "خطا در جایگزینی");
      if (r.ok) {
        setReplaceFile(null);
        await load();
        await openDetail(detail.id); // url جدید + اندازهٔ جدید
      }
    } catch {
      setMsg("خواندن فایل ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!detail) return;
    setBusy(true);
    const r = await call(`/admin/capabilities/media/${detail.id}`, { method: "DELETE" });
    setBusy(false);
    if (r.ok) {
      setDetailOpen(false);
      setDetail(null);
      setMsg("حذف شد.");
      await load();
    } else {
      setMsg(r.error?.message ?? "خطا در حذف");
    }
  };

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-card border border-line bg-surface px-4 py-2 text-sm">{msg}</div>}

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line bg-surface p-8 text-center transition-colors hover:border-primary">
        <span className="text-2xl">🖼️</span>
        <span className="text-sm font-bold text-ink">{uploading ? "در حال آپلود…" : "فایل را انتخاب کن یا بکش"}</span>
        <span className="text-[11px] text-muted">JPG / PNG / WebP / PDF — حداکثر ۱۰MB (ابعاد تصویر خودکار ثبت می‌شود)</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
        />
      </label>

      {/* ---------- فاز ۱۴: تب‌های فیلتر نوع فایل ---------- */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`h-8 rounded-full border px-3 text-xs font-bold transition-colors ${
            filter === "all" ? "border-primary bg-primary text-on-accent" : "border-line bg-surface text-ink/70 hover:border-primary/50"
          }`}
        >
          همه ({fa(counts.all ?? 0)})
        </button>
        {visibleKinds.map((t) => (
          <button
            key={t.kind}
            onClick={() => setFilter(t.kind)}
            className={`h-8 rounded-full border px-3 text-xs font-bold transition-colors ${
              filter === t.kind ? "border-primary bg-primary text-on-accent" : "border-line bg-surface text-ink/70 hover:border-primary/50"
            }`}
          >
            {t.icon} {t.label} ({fa(counts[t.kind] ?? 0)})
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {filter === "all" ? "هنوز فایلی آپلود نشده است." : "در این دسته فایلی نیست."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => void openDetail(m.id)}
              className="group relative overflow-hidden rounded-card border border-line bg-surface text-start transition-colors hover:border-primary"
              title="مشاهدهٔ جزئیات"
            >
              {m.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.alt ?? ""} className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 items-center justify-center text-3xl">{m.kind === "video" ? "🎬" : "📄"}</div>
              )}
              <p className="truncate px-2 py-1 text-[10px] text-muted">{m.alt ?? m.mime}</p>
            </button>
          ))}
        </div>
      )}

      {/* ---------- مودال جزئیات رسانه ---------- */}
      {detailOpen && detail ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => { if (!busy) { setDetailOpen(false); setDetail(null); } }}
        >
          <div className="admin-modal-panel max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-3 shadow-xl sm:p-4" onClick={(e) => e.stopPropagation()} dir="rtl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black">جزئیات فایل</h3>
              <button onClick={() => { setDetailOpen(false); setDetail(null); }} className="text-ink/40 hover:text-ink">✕</button>
            </div>

            <div className="mb-3 flex items-center justify-center rounded-card border border-line bg-ink/5 p-3">
              {detail.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={detail.url} alt={detail.alt ?? ""} className="max-h-56 rounded object-contain" />
              ) : (
                <div className="flex h-40 items-center justify-center text-5xl">{detail.kind === "video" ? "🎬" : "📄"}</div>
              )}
            </div>

            <dl className="mb-3 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2"><dt className="text-muted">نام فایل:</dt><dd className="truncate font-mono text-[11px]" dir="ltr">{detail.storageKey}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">نوع فایل:</dt><dd dir="ltr">{detail.mime}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">حجم:</dt><dd className="tabular-nums">{humanSize(detail.sizeBytes)} ({fa(detail.sizeBytes)} بایت)</dd></div>
              {detail.width ? (
                <div className="flex justify-between"><dt className="text-muted">ابعاد:</dt><dd className="tabular-nums" dir="ltr">{fa(detail.width)}×{fa(detail.height ?? 0)}</dd></div>
              ) : detail.kind === "image" ? (
                <div className="flex justify-between"><dt className="text-muted">ابعاد:</dt><dd className="text-muted">ثبت نشده (فایل قدیمی)</dd></div>
              ) : null}
              <div className="flex justify-between"><dt className="text-muted">تاریخ:</dt><dd className="tabular-nums">{faDate(detail.createdAt)}</dd></div>
              <div className="flex justify-between">
                <dt className="text-muted">در حال استفاده:</dt>
                <dd>
                  {detail.usage.total > 0
                    ? <span className="font-bold text-app-err">بله ({fa(detail.usage.total)} جا)</span>
                    : <span className="text-muted">خیر</span>}
                </dd>
              </div>
            </dl>

            {/* ---------- فاز ۱۴: اقدامات — گشایش/کپی لینک/دانلود ---------- */}
            <div className="mb-3 grid grid-cols-3 gap-2">
              <a
                href={detail.url}
                target="_blank"
                rel="noreferrer"
                className="flex h-9 items-center justify-center rounded-lg border border-line text-xs font-bold hover:border-primary/60"
              >
                گشایش در تب جدید ↗
              </a>
              <button
                onClick={() => void copyLink()}
                className="h-9 rounded-lg border border-line text-xs font-bold hover:border-primary/60"
              >
                {copied ? "کپی شد ✓" : "کپی لینک"}
              </button>
              <a
                href={downloadUrl}
                className="flex h-9 items-center justify-center rounded-lg bg-primary text-xs font-bold text-on-accent"
                download
              >
                دانلود ⬇
              </a>
            </div>

            <div className="mb-3 space-y-2">
              <label className="block text-xs font-bold">متن جایگزین (alt)</label>
              <input value={altDraft} onChange={(e) => setAltDraft(e.target.value)} className="h-9 w-full rounded-lg border border-line px-2 text-xs" dir="auto" />
              <label className="block text-xs font-bold">عنوان</label>
              <input value={titleDraft} onChange={(e) => setTitleDraft(e.target.value)} className="h-9 w-full rounded-lg border border-line px-2 text-xs" dir="auto" />
              <label className="block text-xs font-bold">توضیحات</label>
              <textarea value={captionDraft} onChange={(e) => setCaptionDraft(e.target.value)} rows={2} className="w-full rounded-lg border border-line p-2 text-xs" dir="auto" />
              <button onClick={() => void saveMeta()} disabled={busy} className="h-9 w-full rounded-lg bg-primary font-bold text-on-accent disabled:opacity-40">ذخیرهٔ اطلاعات</button>
            </div>

            <div className="mb-3 rounded-card border border-line p-3">
              <label className="mb-1 block text-xs font-bold">جایگزینی تصویر</label>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                className="w-full text-[11px]"
                onChange={(e) => setReplaceFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => void doReplace()}
                disabled={busy || !replaceFile}
                className="mt-2 h-8 w-full rounded-lg border border-primary/40 text-xs font-bold text-primary-strong disabled:opacity-40"
              >
                {busy ? "در حال جایگزینی…" : "جایگزینی فایل"}
              </button>
            </div>

            {confirmDelete ? (
              <div className="rounded-card border border-app-err/40 bg-app-err/5 p-3">
                <p className="mb-2 text-xs font-bold text-app-err">حذف قطعی؟ این عمل بازگشت‌پذیر نیست.</p>
                {detail.usage.total > 0 && <p className="mb-2 text-[11px] text-app-err">این فایل در {fa(detail.usage.total)} جا استفاده شده — حذف مسدود است.</p>}
                <div className="flex gap-2">
                  <button onClick={() => void doDelete()} disabled={busy || detail.usage.total > 0} className="h-8 flex-1 rounded-lg bg-app-err font-bold text-on-accent disabled:opacity-40">حذف فایل</button>
                  <button onClick={() => setConfirmDelete(false)} className="h-8 flex-1 rounded-lg border border-line text-xs font-bold">انصراف</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="h-8 w-full rounded-lg border border-app-err/40 text-xs font-bold text-app-err">حذف فایل</button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
