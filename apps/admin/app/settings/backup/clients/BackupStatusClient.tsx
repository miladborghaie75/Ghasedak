"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface Latest {
  dir: string;
  name: string;
  startedAt: string | null;
  finishedAt: string | null;
  database: string | null;
  summary: { tables: number; tablesOk: number; tablesFailed: number; totalBytes: number; totalRows: number } | null;
  complete: boolean;
  verifyOk: boolean;
  verifyAt: string | null;
}
interface Task {
  name: string;
  found: boolean;
  enabled: boolean;
  lastRun: string | null;
  lastResult: number | null;
  nextRun: string | null;
}
interface Status {
  available: boolean;
  backupDir: string;
  latest: Latest | null;
  history: Latest[];
  scheduledTask: Task;
  retention: { keep: number; active: number; total: number; deleted: number } | null;
}

const fmt = (s: string | null) => {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" });
};

/** کارت وضعیت پشتیبان‌گیری — فقط نمایش وضعیت واقعی؛ عملیات از ابزار رسمی (بند ۴) */
export default function BackupStatusClient() {
  const { call, loading } = useAdminApi();
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState("");

  const load = async () => {
    const r = await call<Status>("/admin/backup/status");
    if (r.ok && r.data) setSt(r.data);
    else setMsg(r.error?.message ?? "خطا در خواندن وضعیت");
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!st) return <p className="p-6 text-sm text-muted">{msg || "در حال بارگذاری…"}</p>;

  const badge = (ok: boolean, okText: string, badText: string) => (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ok ? "bg-app-ok/15 text-app-ok" : "bg-app-err/15 text-app-err"}`}>
      {ok ? okText : badText}
    </span>
  );

  return (
    <div className="space-y-6">
      {msg && <div className="rounded-card border border-line bg-surface px-4 py-2 text-sm">{msg}</div>}

      <section className="rounded-card border border-line bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-bold text-ink">آخرین پشتیبان</h3>
          {st.latest ? badge(st.latest.complete, "کامل", "ناقص") : badge(false, "", "بدون پشتیبان")}
          {st.latest && badge(st.latest.verifyOk, "تأییدشده", "تأییدنشده")}
        </div>
        {st.latest ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              ["شروع", fmt(st.latest.startedAt)],
              ["پایان", fmt(st.latest.finishedAt)],
              ["جدول‌ها", `${fa(st.latest.summary?.tablesOk ?? 0)} / ${fa(st.latest.summary?.tables ?? 0)}`],
              ["ردیف‌ها", fa(st.latest.summary?.totalRows ?? 0)],
            ].map(([label, val]) => (
              <div key={label} className="rounded-card border border-line bg-bg p-3">
                <p className="text-[11px] text-muted">{label}</p>
                <p className="mt-1 font-display text-sm font-bold text-ink">{val}</p>
              </div>
            ))}
            <div className="col-span-2 lg:col-span-4 rounded-card border border-line bg-bg p-3 text-[11px] text-muted" dir="ltr">
              {st.latest.dir}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">پوشهٔ بکاپ در دسترس نیست: {st.backupDir}</p>
        )}
      </section>

      <section className="rounded-card border border-line bg-surface p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h3 className="font-display text-base font-bold text-ink">زمان‌بند روزانه</h3>
          {st.scheduledTask.found
            ? badge(st.scheduledTask.enabled, st.scheduledTask.enabled ? "فعال" : "غیرفعال", "غیرفعال")
            : badge(false, "", "یافت نشد")}
          {st.scheduledTask.found && st.scheduledTask.lastResult !== null && badge(st.scheduledTask.lastResult === 0, `نتیجهٔ آخرین اجرا: ${st.scheduledTask.lastResult === 0 ? "موفق" : st.scheduledTask.lastResult}`, "")}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {[
            ["آخرین اجرا", fmt(st.scheduledTask.lastRun)],
            ["اجرای بعدی", fmt(st.scheduledTask.nextRun)],
            ["نگهداری (روز)", fa(st.retention?.keep ?? 30)],
          ].map(([label, val]) => (
            <div key={label} className="rounded-card border border-line bg-bg p-3">
              <p className="text-[11px] text-muted">{label}</p>
              <p className="mt-1 font-display text-sm font-bold text-ink">{val}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-card border border-line bg-surface p-5">
        <h3 className="mb-3 font-display text-base font-bold text-ink">تاریخچهٔ اخیر</h3>
        <div className="overflow-hidden rounded-card border border-line">
          <table className="w-full text-xs">
            <thead className="bg-ink/5 text-muted">
              <tr><th className="px-3 py-2 text-start">پوشه</th><th className="px-3 py-2">شروع</th><th className="px-3 py-2">ردیف‌ها</th><th className="px-3 py-2">وضعیت</th></tr>
            </thead>
            <tbody>
              {[...st.history].reverse().map((h) => (
                <tr key={h.name} className="border-t border-line/60">
                  <td className="px-3 py-2 font-mono text-[11px]" dir="ltr">{h.name}</td>
                  <td className="px-3 py-2 text-center">{fmt(h.startedAt)}</td>
                  <td className="px-3 py-2 text-center">{fa(h.summary?.totalRows ?? 0)}</td>
                  <td className="px-3 py-2 text-center">
                    {badge(h.complete, "کامل", "ناقص")}{" "}{badge(h.verifyOk, "تأیید", "—")}
                  </td>
                </tr>
              ))}
              {st.history.length === 0 && <tr><td colSpan={4} className="p-4 text-center text-muted">تاریخچه‌ای نیست.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-muted">
          بکاپ‌گیری و بازیابی فقط با ابزار رسمی انجام می‌شود؛ این صفحه فقط وضعیت واقعی را نشان می‌دهد. راهنما: docs/backup-recovery-guide.md
        </p>
      </section>
    </div>
  );
}
