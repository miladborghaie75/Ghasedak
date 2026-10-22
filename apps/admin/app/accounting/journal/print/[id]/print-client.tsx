"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import MediaLibraryDialog from "@/components/MediaLibraryDialog";

/**
 * صفحهٔ چاپ سند حسابداری + پیوست (فاز ۴).
 *
 * چرا صفحهٔ جدا و نه مودال: چاپ باید خروجیِ تمیز باشد. اگر داخل صفحهٔ
 * اسناد چاپ بگیریم، جدول فیلترها و نوار ابزار هم وارد PDF می‌شوند. اینجا
 * فقط سند است، پس خروجی چاپ همان چیزی است که کاربر می‌بیند.
 *
 * نکتهٔ سرویس اشتراکی: `/api/media/:key` عمومی است (بند ۱۲۴) و نسخهٔ
 * `/media/:key` برای فروشگاه. برای پنل از همان `/api/media` استفاده می‌کنیم
 * چون Next روی `/api/*` پروکسی می‌کند.
 */

interface Att {
  id: string;
  mediaId: string;
  title: string | null;
  alt: string | null;
  mime: string;
  createdAt: string;
  url: string;
}
interface EntryLine {
  id: string;
  debit: string;
  credit: string;
  account: { code: string; name: string };
}
interface Entry {
  id: string;
  number: string;
  date: string;
  description: string | null;
  state: string;
  sourceType: string;
  sourceId: string | null;
  lines: EntryLine[];
}

export default function JournalPrintClient({ id }: { id: string }) {
  const { call, loading } = useAdminApi();
  const [entry, setEntry] = useState<Entry | null>(null);
  const [atts, setAtts] = useState<Att[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showLib, setShowLib] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [e, a] = await Promise.all([
      call<Entry>(`/admin/accounting/journal/${id}`),
      call<{ items: Att[] }>(`/admin/accounting/journal/${id}/attachments`),
    ]);
    if (e.ok && e.data) setEntry(e.data);
    else setError(e.error?.message ?? "خطا در خواندن سند");
    if (a.ok && a.data) setAtts(a.data.items ?? []);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const attach = async (m: { id: string; alt: string | null }) => {
    setBusy(true);
    const r = await call(`/admin/accounting/journal/${id}/attachments`, {
      method: "POST",
      body: JSON.stringify({ mediaId: m.id, title: m.alt ?? undefined }),
    });
    setBusy(false);
    if (r.ok) {
      setMsg("پیوست اضافه شد.");
      await load();
    } else setError(r.error?.message ?? "خطا در پیوست");
  };

  const detach = async (attId: string) => {
    if (!confirm("این پیوست حذف شود؟")) return;
    const r = await call(`/admin/accounting/journal/attachments/${attId}`, { method: "DELETE" });
    if (r.ok) {
      setMsg("پیوست حذف شد.");
      await load();
    } else setError(r.error?.message ?? "خطا در حذف");
  };

  if (loading && !entry) return <p className="p-6 text-sm text-muted">در حال بارگذاری…</p>;
  if (!entry) return <p className="p-6 text-sm text-app-err">{error ?? "سند یافت نشد."}</p>;

  const totalDr = entry.lines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCr = entry.lines.reduce((s, l) => s + Number(l.credit || 0), 0);
  const balanced = totalDr === totalCr;

  return (
    <div className="mx-auto max-w-4xl">
      {/* نوار ابزار — با print-only مخفی می‌شود */}
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => window.print()}
          disabled={!balanced}
          title={balanced ? "چاپ یا ذخیره PDF" : "سند نامتوازن است و نباید چاپ شود"}
          className="h-10 rounded-full bg-primary px-6 text-xs font-black text-on-accent disabled:opacity-40"
        >
          چاپ / ذخیره PDF
        </button>
        <button
          onClick={() => setShowLib(true)}
          disabled={busy}
          className="h-10 rounded-full border border-line px-5 text-xs font-bold disabled:opacity-40"
        >
          + پیوست فایل
        </button>
        {!balanced && (
          <span className="rounded-full bg-app-err/10 px-3 py-1.5 text-[11px] font-bold text-app-err">
            سند نامتوازن است — جمع بدهکار {fa(totalDr.toString())} ≠ بستانکار {fa(totalCr.toString())}
          </span>
        )}
        {entry.state === "DRAFT" && (
          <span className="rounded-full bg-app-warning/10 px-3 py-1.5 text-[11px] font-bold text-app-warning">
            پیش‌نویس
          </span>
        )}
        {msg && <span className="text-[11px] font-bold text-app-ok">{msg}</span>}
        {error && <span className="text-[11px] font-bold text-app-err">{error}</span>}
      </div>

      {/* برگهٔ چاپ */}
      <article className="print-sheet bg-surface p-8 text-ink">
        <header className="mb-6 flex items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <h1 className="text-xl font-black">سند حسابداری</h1>
            <p className="mt-1 text-[11px] text-muted">
              شمارهٔ سند: <span dir="ltr" className="font-mono font-bold">{entry.number}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted">تاریخ: {new Date(entry.date).toLocaleDateString("fa-IR")}</p>
            {entry.description && (
              <p className="mt-2 text-[12px] leading-6">
                شرح: <span className="font-bold">{entry.description}</span>
              </p>
            )}
          </div>
          <div className="text-end">
            {/* محل مُهر و امضا — استاندارد اسناد حسابداری ایران */}
            <div className="stamp-box" />
            <div className="mt-1 text-[9px] text-muted">مهر و امضا</div>
          </div>
        </header>

        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-y border-line bg-ink/[0.04]">
              <th className="px-2 py-2 text-start">کد حساب</th>
              <th className="px-2 py-2 text-start">نام حساب</th>
              <th className="px-2 py-2 text-end">بدهکار</th>
              <th className="px-2 py-2 text-end">بستانکار</th>
            </tr>
          </thead>
          <tbody>
            {entry.lines.map((l) => (
              <tr key={l.id} className="border-b border-line/50">
                <td className="px-2 py-1.5 font-mono" dir="ltr">
                  {l.account.code}
                </td>
                <td className="px-2 py-1.5">{l.account.name}</td>
                <td className="px-2 py-1.5 text-end tabular-nums">{Number(l.debit) ? fa(l.debit) : ""}</td>
                <td className="px-2 py-1.5 text-end tabular-nums">{Number(l.credit) ? fa(l.credit) : ""}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink font-black">
              <td colSpan={2} className="px-2 py-2">
                جمع
              </td>
              <td className="px-2 py-2 text-end tabular-nums">{fa(totalDr.toString())}</td>
              <td className="px-2 py-2 text-end tabular-nums">{fa(totalCr.toString())}</td>
            </tr>
          </tfoot>
        </table>

        <p className="mt-2 text-[10px] text-muted">
          منبع: <span dir="ltr">{entry.sourceType ?? "—"}</span>
          {entry.sourceId ? ` · ${entry.sourceId.slice(0, 12)}` : ""}
        </p>

        {/* پیوست‌ها */}
        {atts.length > 0 && (
          <section className="mt-6 border-t border-line pt-4">
            <h2 className="mb-2 text-[11px] font-black">مدارک پیوست</h2>
            <ul className="space-y-1.5">
              {atts.map((a) => (
                <li key={a.id} className="flex items-center gap-2 border-b border-line/40 pb-1.5">
                  <span className="text-[11px]">{a.title ?? a.alt ?? a.mime}</span>
                  <a
                    href={a.url}
                    target="_blank"
                    rel="noreferrer"
                    className="no-print text-[10px] font-bold text-primary-strong underline"
                  >
                    باز کردن فایل
                  </a>
                  <button
                    onClick={() => void detach(a.id)}
                    disabled={entry.state === "FINAL"}
                    title={entry.state === "FINAL" ? "سند قطعی است — اول به پیش‌نویس برگردان" : "حذف پیوست"}
                    className="no-print ms-auto rounded-full border border-line px-2.5 py-0.5 text-[10px] font-bold text-app-err disabled:opacity-30"
                  >
                    حذف
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-8 flex justify-between gap-8 text-[10px] text-muted">
          <div className="flex-1 border-t border-line pt-1">تنظیم‌کننده</div>
          <div className="flex-1 border-t border-line pt-1">بررسی‌کننده</div>
          <div className="flex-1 border-t border-line pt-1">مدیر مالی</div>
        </footer>
      </article>

      <MediaLibraryDialog
        open={showLib}
        onClose={() => setShowLib(false)}
        onPick={(m) => void attach({ id: m.id, alt: m.alt })}
        title="انتخاب فایل پیوست"
      />
    </div>
  );
}