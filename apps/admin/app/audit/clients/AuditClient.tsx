"use client";

import { useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface AuditRow {
  id: string; actorId: string | null; action: string; entity: string;
  entityId: string | null; ip: string | null; createdAt: string;
}

/** Audit Log — رکوردهای تغییرات (بند ۱۳۹) */
export default function AuditClient() {
  const { call, loading } = useAdminApi();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const load = async (p = 1) => {
    const r = await call<{ items: AuditRow[]; total: number }>(`/admin/audit?page=${p}`);
    if (r.ok && r.data) { setRows(r.data.items); setTotal(r.data.total); setPage(p); }
    else setError(r.error?.message ?? "خطا");
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const pages = Math.max(1, Math.ceil(total / 50));

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">زمان</th><th className="px-4 py-3">عملیات</th><th className="px-4 py-3">موجودیت</th>
              <th className="px-4 py-3">شناسه</th><th className="px-4 py-3">کاربر</th><th className="px-4 py-3">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/50">رکوردی ثبت نشده است.</td></tr>
            ) : rows.map((a) => (
              <tr key={a.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 text-xs text-ink/60">{new Date(a.createdAt).toLocaleString("fa-IR")}</td>
                <td className="px-4 py-3 font-bold" dir="ltr">{a.action}</td>
                <td className="px-4 py-3" dir="ltr">{a.entity}</td>
                <td className="px-4 py-3 text-xs text-ink/50" dir="ltr">{a.entityId?.slice(-8) ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-ink/50" dir="ltr">{a.actorId?.slice(-8) ?? "—"}</td>
                <td className="px-4 py-3 text-xs" dir="ltr">{a.ip ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <button disabled={page <= 1} onClick={() => load(page - 1)} className="h-9 rounded-full border border-line px-4 text-xs font-bold disabled:opacity-40">قبلی</button>
          <span className="text-xs text-ink/60">صفحه {page.toLocaleString("fa-IR")} از {pages.toLocaleString("fa-IR")}</span>
          <button disabled={page >= pages} onClick={() => load(page + 1)} className="h-9 rounded-full border border-line px-4 text-xs font-bold disabled:opacity-40">بعدی</button>
        </div>
      ) : null}
    </div>
  );
}
