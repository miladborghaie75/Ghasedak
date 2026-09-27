"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

/**
 * فاز ۹ — Wave 2 (STEP 13): workspace دامنهٔ چک داخل خزانهٔ موجود.
 * هیچ sidebar جدیدی اضافه نمی‌شود؛ همان صفحهٔ خزانه میزبان این بخش است.
 * هیچ داده/وضعیت جعلی‌ای نمایش داده نمی‌شود — همه‌چیز از API دامنهٔ چک.
 */

interface CheckRow {
  id: string;
  direction: string;
  status: string;
  number: string;
  bankName: string;
  amount: string;
  dueDate: string;
  lifecycleVersion: number;
  customerId: string | null;
  supplierId: string | null;
  customer?: { id: string; name: string | null; mobile: string | null } | null;
  supplier?: { id: string; name: string } | null;
}

const STATUS_FA: Record<string, string> = {
  RECEIVED: "دریافت‌شده",
  DEPOSITED: "سپرده‌شده",
  CLEARED: "وصول‌شده",
  BOUNCED: "برگشتی",
  RETURNED: "عودتی",
  CANCELLED: "ابطال‌شده",
  ISSUED: "صادرشده",
  PRESENTED: "ارائه‌شده",
};

const ACTION_FA: Record<string, string> = {
  CLEARED: "وصول",
  BOUNCED: "ثبت برگشت",
  CANCELLED: "ابطال",
  DEPOSITED: "ثبت سپرده",
  PRESENTED: "ثبت ارائه",
};

export default function ChecksWorkspace() {
  const { call, loading } = useAdminApi();
  const [items, setItems] = useState<CheckRow[] | null>(null);
  const [status, setStatus] = useState("");
  const [direction, setDirection] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; transitions: Array<{ version: number; fromStatus: string | null; toStatus: string; createdAt: string; reason: string | null }> } | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (status) qs.set("status", status);
    if (direction) qs.set("direction", direction);
    const r = await call<{ items: CheckRow[] }>(`/admin/checks${qs.size ? `?${qs}` : ""}`);
    if (r.ok && r.data) setItems(r.data.items);
    else setError(r.error?.message ?? "خطا");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, direction]);

  useEffect(() => {
    void load();
  }, [load]);

  /** destructive عملیات با confirm صریح — هیچ عملیات بی‌تأییدی */
  const act = async (checkId: string, action: "clear" | "bounce" | "cancel" | "transition", toStatus?: string) => {
    const label = toStatus ? (ACTION_FA[toStatus] ?? toStatus) : action;
    if (!window.confirm(`عملیات «${label}» روی چک انتخابی انجام شود؟ این عملیات سند حسابداری/اثر خزانه‌ای دارد و قابل برگشت نیست.`)) return;
    setError(null);
    setMsg(null);
    const path = toStatus ? `/admin/checks/${checkId}/transition` : `/admin/checks/${checkId}/${action}`;
    const body = toStatus ? { toStatus, idempotencyKey: `${checkId}:${toStatus}:${Date.now()}` } : { idempotencyKey: `${checkId}:${action}:${Date.now()}` };
    const r = await call<Record<string, unknown>>(path, { method: "POST", body: JSON.stringify(body) });
    if (r.ok) {
      setMsg(`${label} ثبت شد.`);
      await load();
    } else {
      setError(r.error?.message ?? "خطا");
    }
  };

  const openHistory = async (id: string) => {
    const r = await call<{ check: { transitions: Array<{ version: number; fromStatus: string | null; toStatus: string; createdAt: string; reason: string | null }> } }>(`/admin/checks/${id}`);
    if (r.ok && r.data) {
      setHistory({ id, transitions: r.data.check.transitions });
    } else setError(r.error?.message ?? "خطا");
  };

  return (
    <section className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-bold">دامنهٔ چک — لیست و عملیات lifecycle</h2>
        <div className="flex gap-2 text-xs">
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1">
            <option value="">همه جهت‌ها</option>
            <option value="RECEIVED">دریافتی</option>
            <option value="ISSUED">صادره</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-[var(--border)] bg-transparent px-2 py-1">
            <option value="">همه وضعیت‌ها</option>
            {Object.entries(STATUS_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      {msg && <div className="text-xs text-emerald-600 mb-2">{msg}</div>}
      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
      <div className="rounded-xl border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-[var(--muted)]/40">
            <tr>
              <th className="p-2 text-right">شماره</th>
              <th className="p-2 text-right">جهت</th>
              <th className="p-2 text-right">وضعیت</th>
              <th className="p-2 text-right">مبلغ</th>
              <th className="p-2 text-right">سررسید</th>
              <th className="p-2 text-right">بانک</th>
              <th className="p-2 text-right">طرف حساب</th>
              <th className="p-2 text-right">نسخه</th>
              <th className="p-2 text-right">عملیات</th>
            </tr>
          </thead>
          <tbody>
            {(items ?? []).map((c) => {
              const live = !["CLEARED", "BOUNCED", "RETURNED", "CANCELLED"].includes(c.status);
              const party = c.customer?.name ?? c.supplier?.name ?? "—";
              return (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="p-2" dir="ltr">{c.number}</td>
                  <td className="p-2">{c.direction === "RECEIVED" ? "دریافتی" : "صادره"}</td>
                  <td className="p-2">{STATUS_FA[c.status] ?? c.status}</td>
                  <td className="p-2">{fa(c.amount)}</td>
                  <td className="p-2" dir="ltr">{new Date(c.dueDate).toLocaleDateString("fa-IR")}</td>
                  <td className="p-2">{c.bankName}</td>
                  <td className="p-2">{party}</td>
                  <td className="p-2" dir="ltr">{c.lifecycleVersion}</td>
                  <td className="p-2">
                    <div className="flex gap-1 flex-wrap">
                      {live && (c.status === "RECEIVED" || c.status === "DEPOSITED") && (
                        <button disabled={loading} onClick={() => void act(c.id, "clear")} className="rounded border border-[var(--border)] px-1.5 py-0.5 hover:bg-[var(--muted)]/40">وصول</button>
                      )}
                      {live && c.status === "ISSUED" && (
                        <button disabled={loading} onClick={() => void act(c.id, "transition", "PRESENTED")} className="rounded border border-[var(--border)] px-1.5 py-0.5 hover:bg-[var(--muted)]/40">ارائه به بانک</button>
                      )}
                      {live && (
                        <button disabled={loading} onClick={() => void act(c.id, "bounce")} className="rounded border border-red-400/60 text-red-600 px-1.5 py-0.5 hover:bg-red-500/10">برگشت</button>
                      )}
                      {live && c.direction === "ISSUED" && (
                        <button disabled={loading} onClick={() => void act(c.id, "cancel")} className="rounded border border-[var(--border)] px-1.5 py-0.5 hover:bg-[var(--muted)]/40">ابطال</button>
                      )}
                      <button onClick={() => void openHistory(c.id)} className="rounded border border-[var(--border)] px-1.5 py-0.5 hover:bg-[var(--muted)]/40">تاریخچه</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(items ?? []).length === 0 && (
              <tr><td className="p-3 text-[var(--muted)]" colSpan={9}>چکی ثبت نشده — چک‌ها از POS/خرید/AR ساخته می‌شوند.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {history && (
        <div className="mt-2 rounded-xl border border-[var(--border)] p-3 text-xs">
          <div className="flex justify-between mb-1">
            <b>تاریخچه lifecycle</b>
            <button onClick={() => setHistory(null)} className="text-[var(--muted)]">بستن</button>
          </div>
          <ol className="space-y-1">
            {history.transitions.map((t) => (
              <li key={t.version} dir="ltr" className="flex gap-2">
                <span className="text-[var(--muted)]">v{t.version}</span>
                <span>{t.fromStatus ?? "—"} → <b>{STATUS_FA[t.toStatus] ?? t.toStatus}</b></span>
                <span className="text-[var(--muted)]">{new Date(t.createdAt).toLocaleString("fa-IR")}{t.reason ? ` — ${t.reason}` : ""}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
