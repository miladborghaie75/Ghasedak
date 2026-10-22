"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

type Action = "CREATE" | "UPDATE" | "SKIP" | "ERROR";

interface Change {
  path: string;
  label: string;
  before: string | null;
  after: string | null;
}
interface RowView {
  id: string;
  rowNo: number;
  action: Action;
  sku: string;
  entityId: string | null;
  message: string | null;
  changes: Change[];
}
interface Counts {
  rowCount: number;
  CREATE: number;
  UPDATE: number;
  SKIP: number;
  ERROR: number;
}
interface BatchView {
  batchId: string;
  filename: string;
  status: "PREVIEWED" | "APPLIED" | "REVERTED" | "FAILED";
  counts: Counts;
  rows: RowView[];
  unknownColumns: string[];
}
interface HistoryRow {
  id: string;
  filename: string;
  status: string;
  rowCount: number;
  createCount: number;
  updateCount: number;
  skipCount: number;
  errorCount: number;
  createdAt: string;
  appliedAt: string | null;
  revertedAt: string | null;
}

const MAX_BYTES = 5 * 1024 * 1024;

const ACTION_META: Record<Action, { label: string; cls: string; dot: string }> = {
  CREATE: { label: "ایجاد", cls: "bg-app-ok/15 text-app-ok", dot: "bg-app-ok" },
  UPDATE: { label: "ویرایش", cls: "bg-primary/15 text-primary", dot: "bg-primary" },
  SKIP: { label: "بدون تغییر", cls: "bg-ink/5 text-muted", dot: "bg-muted" },
  ERROR: { label: "خطا", cls: "bg-app-err/15 text-app-err", dot: "bg-app-err" },
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  PREVIEWED: { label: "پیش‌نمایش", cls: "bg-primary/15 text-primary" },
  APPLIED: { label: "اعمال‌شده", cls: "bg-app-ok/15 text-app-ok" },
  REVERTED: { label: "بازگردانده‌شده", cls: "bg-ink/5 text-muted" },
  FAILED: { label: "ناموفق", cls: "bg-app-err/15 text-app-err" },
};

const COLUMN_HELP: Array<[string, string]> = [
  ["SKU", "الزامی. کلید تطبیق ردیف: اگر وجود داشته باشد ویرایش می‌شود، وگرنه ایجاد."],
  ["نام محصول", "برای SKU جدید الزامی است؛ برای SKU موجود فقط اگر بخواهی نام عوض شود."],
  ["اسلاگ", "اختیاری. خالی بگذاری از نام ساخته می‌شود؛ باید یکتا باشد."],
  ["دسته", "نام یا اسلاگ دستهٔ موجود. دستهٔ تازه را اول از پنل دسته‌ها بساز؛ از فایل ساخته نمی‌شود."],
  ["برند", "اختیاری؛ باید از قبل در پنل ساخته شده باشد."],
  ["وضعیت", "DRAFT / PUBLISHED / ARCHIVED یا پیش‌نویس / منتشرشده / آرشیو."],
  ["قیمت", "تومان، عدد صحیح. ارقام فارسی و جداکنندهٔ هزارگان پذیرفته می‌شود."],
  ["قیمت حراج", "اختیاری و نباید از قیمت بیشتر باشد. برای پاک‌کردن، «-» بگذار."],
  ["بهای خرید", "برای سند موجودی آغازین. برای پاک‌کردن، «-» بگذار."],
  ["موجودی", "فقط برای SKU جدید به‌عنوان موجودی آغازین. SKU موجود از این ستون تغییر نمی‌کند."],
  ["بارکد", "اختیاری؛ خالی بگذاری بارکد داخلی ساخته می‌شود."],
];

const fmtDate = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
};

export default function ImportClient() {
  const { call, loading } = useAdminApi();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<BatchView | null>(null);
  const [filter, setFilter] = useState<"ALL" | Action>("ALL");
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const loadHistory = async () => {
    const r = await call<{ items: HistoryRow[] }>("/admin/import?limit=10");
    if (r.ok && r.data) setHistory(r.data.items);
  };
  useEffect(() => { void loadHistory(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFile = async (file: File | null) => {
    setError(null);
    setMsg(null);
    setPreview(null);
    setConfirmApply(false);
    setConfirmRevert(false);
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(`حجم فایل ${fa(Math.round(file.size / 1024))} کیلوبایت است؛ سقف ۵ مگابایت. فایل را تقسیم کن.`);
      return;
    }
    setFileName(file.name);
    setText(await file.text());
  };

  const runPreview = async () => {
    setError(null);
    setMsg(null);
    setConfirmApply(false);
    if (!text.trim()) {
      setError("اول فایل CSV را انتخاب کن.");
      return;
    }
    setBusy(true);
    try {
      const r = await call<{
        batchId: string;
        filename: string;
        counts: Counts;
        rows: RowView[];
        unknownColumns: string[];
      }>("/admin/import/preview", {
        method: "POST",
        body: JSON.stringify({ filename: fileName || "import.csv", text }),
      });
      if (!r.ok || !r.data) {
        setError(r.error?.message ?? "پیش‌نمایش انجام نشد؛ فایل را بررسی کن و دوباره بزن.");
        return;
      }
      setPreview({
        batchId: r.data.batchId,
        filename: r.data.filename,
        status: "PREVIEWED",
        counts: r.data.counts,
        rows: r.data.rows,
        unknownColumns: r.data.unknownColumns,
      });
      setFilter("ALL");
      setMsg("پیش‌نمایش آماده است؛ هنوز هیچ محصولی نوشته نشده.");
      void loadHistory();
    } finally {
      setBusy(false);
    }
  };

  const loadBatch = async (id: string) => {
    setError(null);
    setMsg(null);
    setConfirmApply(false);
    setConfirmRevert(false);
    const r = await call<{
      id: string;
      filename: string;
      status: BatchView["status"];
      counts: Counts;
      rows: RowView[];
    }>(`/admin/import/${id}`);
    if (!r.ok || !r.data) {
      setError(r.error?.message ?? "دسته خوانده نشد؛ یک‌بار دیگر تلاش کن.");
      return;
    }
    setPreview({
      batchId: r.data.id,
      filename: r.data.filename,
      status: r.data.status,
      counts: r.data.counts,
      rows: r.data.rows,
      unknownColumns: [],
    });
    setFilter("ALL");
  };

  const apply = async () => {
    if (!preview) return;
    if (!confirmApply) {
      setConfirmApply(true);
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await call<{ counts: Counts; alreadyApplied: boolean }>(`/admin/import/${preview.batchId}/apply`, {
        method: "POST",
      });
      if (!r.ok || !r.data) {
        setError(r.error?.message ?? "اعمال انجام نشد؛ پیام خطا را ببین و دوباره تلاش کن.");
        return;
      }
      // اول تازه‌سازی وضعیت، بعد پیام — وگرنه loadBatch پیام را پاک می‌کند
      await loadBatch(preview.batchId);
      setMsg(
        r.data.alreadyApplied
          ? "این دسته از قبل اعمال شده است؛ نوشتن دوباره انجام نمی‌شود."
          : `اعمال شد: ${fa(r.data.counts.CREATE)} ایجاد، ${fa(r.data.counts.UPDATE)} ویرایش.`,
      );
      void loadHistory();
    } finally {
      setBusy(false);
      setConfirmApply(false);
    }
  };

  const revert = async () => {
    if (!preview) return;
    if (!confirmRevert) {
      setConfirmRevert(true);
      return;
    }
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const r = await call<{ alreadyReverted: boolean; reverted: { CREATE: number; UPDATE: number } }>(
        `/admin/import/${preview.batchId}/revert`,
        { method: "POST" },
      );
      if (!r.ok || !r.data) {
        setError(r.error?.message ?? "بازگردانی انجام نشد؛ وضعیت دسته را ببین و دوباره تلاش کن.");
        return;
      }
      await loadBatch(preview.batchId);
      setMsg(
        r.data.alreadyReverted
          ? "این دسته قبلاً بازگردانده شده بود."
          : `بازگردانده شد: ${fa(r.data.reverted.CREATE)} ایجاد برگشت، ${fa(r.data.reverted.UPDATE)} فیلد به قبل برگشت.`,
      );
      void loadHistory();
    } finally {
      setBusy(false);
      setConfirmRevert(false);
    }
  };

  const counts = preview?.counts;
  const filtered = useMemo(
    () => (preview ? (filter === "ALL" ? preview.rows : preview.rows.filter((r) => r.action === filter)) : []),
    [preview, filter],
  );
  const canApply = !!preview && preview.status === "PREVIEWED" && (counts?.ERROR ?? 1) === 0 && (counts?.CREATE ?? 0) + (counts?.UPDATE ?? 0) > 0;
  const canRevert = !!preview && preview.status === "APPLIED";

  return (
    <div className="space-y-6">
      {msg && <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p>}
      {error && <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p>}

      {/* ---------- ۱) فایل ---------- */}
      <section className="rounded-card border border-line bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-bold text-ink">۱) فایل CSV</h3>
          <a
            href="/api/admin/import/template"
            className="rounded-full border border-line px-4 py-1.5 text-xs font-bold text-ink transition-colors hover:bg-primary-soft"
          >
            دانلود قالب نمونه
          </a>
        </div>
        <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-line bg-bg p-8 text-center transition-colors hover:border-primary">
          <span className="text-2xl">📄</span>
          <span className="text-sm font-bold text-ink">{fileName || "فایل CSV را انتخاب کن"}</span>
          <span className="text-[11px] text-muted">حداکثر ۵ مگابایت و ۵٬۰۰۰ ردیف — UTF-8</span>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => void pickFile(e.target.files?.[0] ?? null)}
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            onClick={() => void runPreview()}
            disabled={busy || !text.trim()}
            className="h-10 rounded-full bg-primary px-5 text-sm font-black text-on-accent disabled:opacity-60"
          >
            {busy ? "در حال بررسی…" : "پیش‌نمایش"}
          </button>
          <button
            onClick={() => { setText(""); setFileName(""); setPreview(null); setMsg(null); setError(null); if (fileRef.current) fileRef.current.value = ""; }}
            disabled={busy}
            className="h-10 rounded-full border border-line px-4 text-xs font-bold text-ink"
          >
            پاک‌کردن
          </button>
          <span className="text-[11px] text-muted">
            Excel: «Save as → CSV UTF-8». ارقام فارسی و جداکنندهٔ هزارگان پذیرفته می‌شود.
          </span>
        </div>

        <details className="mt-4 rounded-card border border-line bg-bg p-3">
          <summary className="cursor-pointer text-xs font-bold text-ink">راهنمای ستون‌ها</summary>
          <ul className="mt-2 space-y-1.5">
            {COLUMN_HELP.map(([name, help]) => (
              <li key={name} className="text-[11px] leading-5 text-muted">
                <span className="font-bold text-ink">{name}:</span> {help}
              </li>
            ))}
          </ul>
        </details>
      </section>

      {/* ---------- ۲) پیش‌نمایش ---------- */}
      {preview && (
        <section className="rounded-card border border-line bg-surface p-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="font-display text-base font-bold text-ink">۲) پیش‌نمایش «{preview.filename}»</h3>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_META[preview.status].cls}`}>
              {STATUS_META[preview.status].label}
            </span>
          </div>

          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(["CREATE", "UPDATE", "SKIP", "ERROR"] as Action[]).map((a) => (
              <div key={a} className="rounded-card border border-line bg-bg p-3">
                <p className="text-[11px] text-muted">{ACTION_META[a].label}</p>
                <p className="mt-1 font-display text-lg font-black text-ink">{fa(counts?.[a] ?? 0)}</p>
              </div>
            ))}
          </div>

          {preview.unknownColumns.length > 0 && (
            <p className="mb-3 rounded-xl bg-primary-tint/40 px-3 py-2 text-[11px] text-ink">
              این ستون‌ها شناخته نشدند و نادیده گرفته شدند: {preview.unknownColumns.join("، ")}
            </p>
          )}
          {(counts?.ERROR ?? 0) > 0 && (
            <p className="mb-3 rounded-xl bg-app-err/10 px-3 py-2 text-[11px] font-bold text-app-err">
              تا وقتی ردیف خطا وجود دارد اعمال ممکن نیست. ردیف‌ها را در فایل درست کن و دوباره پیش‌نمایش بگیر.
            </p>
          )}

          <div className="mb-3 flex flex-wrap gap-1.5">
            {([
              ["ALL", `همه (${fa(counts?.rowCount ?? 0)})`],
              ["CREATE", `ایجاد (${fa(counts?.CREATE ?? 0)})`],
              ["UPDATE", `ویرایش (${fa(counts?.UPDATE ?? 0)})`],
              ["SKIP", `بدون تغییر (${fa(counts?.SKIP ?? 0)})`],
              ["ERROR", `خطا (${fa(counts?.ERROR ?? 0)})`],
            ] as Array<["ALL" | Action, string]>).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === k ? "bg-primary text-on-accent" : "border border-line bg-surface text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-card border border-line">
            <div className="admin-table-wrap max-h-[28rem] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-ink/5 text-muted">
                  <tr>
                    <th className="px-3 py-2 text-start">سطر</th>
                    <th className="px-3 py-2 text-start">SKU</th>
                    <th className="px-3 py-2 text-start">تصمیم</th>
                    <th className="px-3 py-2 text-start">تفاوت / پیام</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-t border-line/60 align-top">
                      <td className="px-3 py-2 text-center tabular-nums text-muted">{fa(r.rowNo)}</td>
                      <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{r.sku || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${ACTION_META[r.action].cls}`}>
                          <span className={`inline-block h-1.5 w-1.5 rounded-full ${ACTION_META[r.action].dot}`} />
                          {ACTION_META[r.action].label}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {r.changes.length > 0 && (
                          <ul className="space-y-0.5">
                            {r.changes.map((c) => (
                              <li key={c.path} className="text-[11px] text-ink">
                                <span className="font-bold">{c.label}:</span>{" "}
                                <span className="text-muted">{c.before ?? "—"}</span>
                                {" → "}
                                <span className="font-bold">{c.after ?? "—"}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {r.message && <p className={`text-[11px] ${r.action === "ERROR" ? "font-bold text-app-err" : "text-muted"}`}>{r.message}</p>}
                        {r.changes.length === 0 && !r.message && <span className="text-[11px] text-muted">—</span>}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={4} className="p-4 text-center text-muted">ردیفی در این فیلتر نیست.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {canApply && (
              <>
                <button
                  onClick={() => void apply()}
                  disabled={busy}
                  className={`h-10 rounded-full px-5 text-sm font-black text-on-accent disabled:opacity-60 ${confirmApply ? "bg-app-err" : "bg-primary"}`}
                >
                  {busy ? "در حال اعمال…" : confirmApply ? `بله، ${fa((counts?.CREATE ?? 0) + (counts?.UPDATE ?? 0))} ردیف اعمال شود` : "اعمال روی محصولات"}
                </button>
                {confirmApply && (
                  <button onClick={() => setConfirmApply(false)} className="h-10 rounded-full border border-line px-4 text-xs font-bold">
                    انصراف
                  </button>
                )}
              </>
            )}
            {preview.status === "APPLIED" && (
              <>
                <button
                  onClick={() => void revert()}
                  disabled={busy}
                  className={`h-10 rounded-full px-5 text-sm font-black disabled:opacity-60 ${confirmRevert ? "bg-app-err text-on-accent" : "border border-line text-ink"}`}
                >
                  {busy ? "در حال بازگردانی…" : confirmRevert ? "بله، بازگردانی کن" : "بازگردانی این دسته"}
                </button>
                {confirmRevert && (
                  <button onClick={() => setConfirmRevert(false)} className="h-10 rounded-full border border-line px-4 text-xs font-bold">
                    انصراف
                  </button>
                )}
                <span className="text-[11px] text-muted">
                  بازگردانی فقط وقتی ممکن است که دستهٔ جدیدتری روی همین SKUها اعمال نشده باشد.
                </span>
              </>
            )}
          </div>
        </section>
      )}

      {/* ---------- ۳) تاریخچه ---------- */}
      <section className="rounded-card border border-line bg-surface p-5">
        <h3 className="mb-3 font-display text-base font-bold text-ink">دسته‌های اخیر</h3>
        <div className="overflow-hidden rounded-card border border-line">
          <div className="admin-table-wrap"><table className="w-full text-xs">
            <thead className="bg-ink/5 text-muted">
              <tr>
                <th className="px-3 py-2 text-start">فایل</th>
                <th className="px-3 py-2">وضعیت</th>
                <th className="px-3 py-2">ردیف</th>
                <th className="px-3 py-2">ایجاد/ویرایش/خطا</th>
                <th className="px-3 py-2">زمان</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className={`border-t border-line/60 ${preview?.batchId === h.id ? "bg-primary-tint/30" : ""}`}>
                  <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{h.filename}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${(STATUS_META[h.status] ?? STATUS_META.FAILED).cls}`}>
                      {(STATUS_META[h.status] ?? STATUS_META.FAILED).label}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums">{fa(h.rowCount)}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{fa(h.createCount)}/{fa(h.updateCount)}/{fa(h.errorCount)}</td>
                  <td className="px-3 py-2 text-center text-[11px] text-muted">{fmtDate(h.createdAt)}</td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => void loadBatch(h.id)} className="rounded-full border border-line px-3 py-1 text-[11px] font-bold hover:bg-primary-soft">
                      دیدن
                    </button>
                  </td>
                </tr>
              ))}
              {history.length === 0 && <tr><td colSpan={6} className="p-4 text-center text-muted">هنوز دسته‌ای ثبت نشده است.</td></tr>}
            </tbody>
          </table></div>
        </div>
        {loading && <p className="mt-2 text-[11px] text-muted">در حال همگام‌سازی…</p>}
        <p className="mt-2 text-[11px] text-muted">
          پیش‌نمایش هیچ محصولی را تغییر نمی‌دهد. اعمال همه‌یا‌هیچ است و موجودی فقط از مسیر انبار نوشته می‌شود.
        </p>
      </section>
    </div>
  );
}
