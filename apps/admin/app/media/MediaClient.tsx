"use client";

import { useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface MediaRow { id: string; mime: string; sizeBytes: number | string; alt: string | null; url: string }

/** Media Library — آپلود واقعی با اعتبارسنجی MIME/magic (بند ۳۵) */
export default function MediaLibrary() {
  const { call, loading } = useAdminApi();
  const [items, setItems] = useState<MediaRow[]>([]);
  const [msg, setMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    const r = await call<{ items: MediaRow[] }>("/admin/capabilities/media");
    if (r.ok && r.data) setItems(r.data.items);
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = async (file: File) => {
    setUploading(true);
    setMsg("");
    try {
      const buf = await file.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const dataBase64 = btoa(binary);
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

  const remove = async (id: string) => {
    const r = await call(`/admin/capabilities/media/${id}`, { method: "DELETE" });
    setMsg(r.ok ? "حذف شد." : r.error?.message ?? "خطا");
    if (r.ok) await load();
  };

  return (
    <div className="space-y-4">
      {msg && <div className="rounded-card border border-line bg-surface px-4 py-2 text-sm">{msg}</div>}

      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line bg-surface p-8 text-center transition-colors hover:border-primary">
        <span className="text-2xl">🖼️</span>
        <span className="text-sm font-bold text-ink">{uploading ? "در حال آپلود…" : "فایل را انتخاب کنید یا بکشید"}</span>
        <span className="text-[11px] text-muted">JPG / PNG / WebP / PDF — حداکثر ۱۰MB (اعتبارسنجی محتوا انجام می‌شود)</span>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
        />
      </label>

      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">هنوز فایلی آپلود نشده است.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((m) => (
            <div key={m.id} className="group relative overflow-hidden rounded-card border border-line bg-surface">
              {m.mime.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.url} alt={m.alt ?? ""} className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 items-center justify-center text-3xl">📄</div>
              )}
              <button
                onClick={() => void remove(m.id)}
                className="absolute end-1 top-1 hidden rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white group-hover:block"
              >
                حذف
              </button>
              <p className="truncate px-2 py-1 text-[10px] text-muted">{m.alt ?? m.mime}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
