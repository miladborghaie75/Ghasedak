"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi } from "@/components/useAdminApi";

interface NotificationRow {
  id: string;
  channel: "SMS" | "EMAIL";
  templateKey: string;
  to: string;
  status: "QUEUED" | "SENT" | "FAILED";
  lastError: string | null;
  attempts: number;
  sentAt: string | null;
  createdAt: string;
}

interface NotificationsResponse {
  items: NotificationRow[];
  summary: { queued: number; sent: number; failed: number; notConfigured: number };
}

const STATUS_LABEL: Record<string, string> = {
  QUEUED: "در صف",
  SENT: "ارسال شده",
  FAILED: "ناموفق",
};

/** فاز ۱۱ (P2-B) — workspace اعلان‌ها: Pending/Sent/Failed/NotConfigured + retry و dispatch دستی */
export default function NotificationsClient() {
  const { call, loading } = useAdminApi();
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [filter, setFilter] = useState<"ALL" | "QUEUED" | "SENT" | "FAILED">("ALL");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const q = filter === "ALL" ? "" : `?status=${filter}`;
    const r = await call<NotificationsResponse>(`/admin/capabilities/notifications${q}`);
    if (r.ok && r.data) setData(r.data);
  }, [call, filter]);

  useEffect(() => { void load(); }, [load]);

  const retry = async (id: string) => {
    setBusy(true);
    const r = await call<{ ok: boolean; status: string; lastError: string | null }>(`/admin/capabilities/notifications/${id}/retry`, { method: "POST" });
    setMsg(r.ok && r.data?.ok ? "ارسال شد ✅" : r.ok && r.data ? `هنوز ارسال نشده: ${r.data.status}${r.data.lastError ? ` — ${r.data.lastError}` : ""}` : r.error?.message ?? "خطا");
    setBusy(false);
    setTimeout(() => setMsg(""), 4000);
    void load();
  };

  const dispatchNow = async () => {
    setBusy(true);
    const r = await call<{ sent: number; failed: number; notConfigured: number }>("/admin/capabilities/notifications/dispatch", { method: "POST" });
    setMsg(r.ok && r.data ? `dispatch: sent=${r.data.sent} failed=${r.data.failed} notConfigured=${r.data.notConfigured}` : r.error?.message ?? "خطا");
    setBusy(false);
    setTimeout(() => setMsg(""), 4000);
    void load();
  };

  const fa = (d: string | null) => (d ? new Date(d).toLocaleString("fa-IR") : "—");

  return (
    <div className="space-y-4">
      {/* KPIها — وضعیت واقعی صف؛ بدون ساختگی (بند ۱۱۱) */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs text-ink/60">در صف</div>
          <div className="text-2xl font-bold tabular-nums">{data?.summary.queued ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs text-ink/60">ارسال شده</div>
          <div className="text-2xl font-bold tabular-nums">{data?.summary.sent ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs text-ink/60">ناموفق</div>
          <div className="text-2xl font-bold tabular-nums text-red-600">{data?.summary.failed ?? "—"}</div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs text-ink/60">بدون تنظیمات (Not Configured)</div>
          <div className="text-2xl font-bold tabular-nums text-amber-600">{data?.summary.notConfigured ?? "—"}</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(["ALL", "QUEUED", "SENT", "FAILED"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${filter === f ? "bg-ink text-paper" : "border border-line bg-surface hover:bg-ink/5"}`}
          >
            {f === "ALL" ? "همه" : STATUS_LABEL[f]}
          </button>
        ))}
        <button
          onClick={dispatchNow}
          disabled={busy || loading}
          className="ms-auto rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          اجرای صف الان
        </button>
      </div>

      {msg && <div className="rounded-lg border border-line bg-surface p-3 text-sm">{msg}</div>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-ink/5 text-xs text-ink/60">
            <tr>
              <th className="px-4 py-2 text-start">کانال</th>
              <th className="px-4 py-2 text-start">مقصد</th>
              <th className="px-4 py-2 text-start">الگو</th>
              <th className="px-4 py-2 text-start">وضعیت</th>
              <th className="px-4 py-2 text-start">تلاش</th>
              <th className="px-4 py-2 text-start">آخرین خطا</th>
              <th className="px-4 py-2 text-start">ایجاد</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((n) => (
              <tr key={n.id} className="border-t border-line/60">
                <td className="px-4 py-2">{n.channel}</td>
                <td className="px-4 py-2" dir="ltr">{n.to}</td>
                <td className="max-w-[220px] truncate px-4 py-2 text-xs text-ink/60">{n.templateKey}</td>
                <td className="px-4 py-2">
                  <span className={
                    n.status === "SENT" ? "text-emerald-600" : n.status === "FAILED" ? "text-red-600" : "text-amber-600"
                  }>
                    {STATUS_LABEL[n.status]}
                  </span>
                  {n.status === "QUEUED" && n.lastError?.startsWith("NOT_CONFIGURED") && (
                    <span className="ms-1 text-[10px] text-ink/40">(بدون credential)</span>
                  )}
                </td>
                <td className="px-4 py-2 tabular-nums">{n.attempts}</td>
                <td className="max-w-[240px] truncate px-4 py-2 text-xs text-ink/60" title={n.lastError ?? ""}>{n.lastError ?? "—"}</td>
                <td className="px-4 py-2 text-xs tabular-nums">{fa(n.createdAt)}</td>
                <td className="px-4 py-2">
                  {n.status === "FAILED" && (
                    <button
                      onClick={() => retry(n.id)}
                      disabled={busy}
                      className="rounded-lg border border-line px-2 py-1 text-xs font-bold hover:bg-ink/5 disabled:opacity-50"
                    >
                      تلاش مجدد
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-ink/40">ردیفی نیست.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
