"use client";

/**
 * فاز ۱۰ — بخش ۱۱: workspace اختصاصی چک با tabs کامل lifecycle.
 * Tabs: Received / Issued / Due Soon / Deposited / Cleared / Bounced / Returned / Cancelled
 * Actions مطابق lifecycle: Deposit / Clear / Bounce / Return / Cancel — Match ≠ Clear.
 * ثبت چک جدید (دریافتی/صادره) از همین workspace — همان POST /admin/checks (reuse).
 * هیچ sidebar جدیدی اضافه نمی‌شود؛ میزبان همان صفحهٔ خزانه.
 */

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

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
  TRANSFERRED: "خرج‌شده",
};

type TabKey = "received" | "issued" | "due-soon" | "deposited" | "cleared" | "bounced" | "returned" | "cancelled";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "received", label: "دریافتی" },
  { key: "issued", label: "صادره" },
  { key: "due-soon", label: "نزدیک سررسید" },
  { key: "deposited", label: "سپرده‌شده" },
  { key: "cleared", label: "وصول‌شده" },
  { key: "bounced", label: "برگشتی" },
  { key: "returned", label: "عودتی" },
  { key: "cancelled", label: "ابطال‌شده" },
];

const TAB_QUERY: Record<TabKey, { status?: string; direction?: string; dueSoon?: boolean }> = {
  received: { status: "RECEIVED" },
  issued: { status: "ISSUED" },
  "due-soon": { dueSoon: true },
  deposited: { status: "DEPOSITED" },
  cleared: { status: "CLEARED" },
  bounced: { status: "BOUNCED" },
  returned: { status: "RETURNED" },
  cancelled: { status: "CANCELLED" },
};

export default function ChecksWorkspace() {
  const { call, loading } = useAdminApi();
  const [tab, setTab] = useState<TabKey>("received");
  const [items, setItems] = useState<CheckRow[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ id: string; transitions: Array<{ version: number; fromStatus: string | null; toStatus: string; createdAt: string; reason: string | null }> } | null>(null);

  // فرم ثبت چک (بخش ۱۱ + ۳)
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    direction: "RECEIVED" as "RECEIVED" | "ISSUED",
    number: "", bankName: "", branch: "", accountNo: "", amount: "",
    dueDate: "", issueDate: "", customerId: "", supplierId: "", notes: "",
  });

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    const f = TAB_QUERY[tab];
    if (f.status) qs.set("status", f.status);
    if (f.direction) qs.set("direction", f.direction);
    if (f.dueSoon) qs.set("dueBefore", new Date(Date.now() + 14 * 86_400_000).toISOString());
    const r = await call<{ items: CheckRow[] }>(`/admin/checks?${qs}&take=100`);
    if (r.ok && r.data) setItems(r.data.items);
    else setError(r.error?.message ?? "خطا");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  const act = async (checkId: string, action: "clear" | "bounce" | "cancel" | "transition", toStatus?: string) => {
    const label = toStatus ? (ACTION_FA[toStatus] ?? toStatus) : action;
    if (!window.confirm(`عملیات «${label}» روی چک انجام شود؟ سند حسابداری/اثر خزانه‌ای دارد.`)) return;
    setError(null); setMsg(null);
    const path = toStatus ? `/admin/checks/${checkId}/transition` : `/admin/checks/${checkId}/${action}`;
    const body = toStatus ? { toStatus, idempotencyKey: `${checkId}:${toStatus}:${Date.now()}` } : { idempotencyKey: `${checkId}:${action}:${Date.now()}` };
    const r = await call<Record<string, unknown>>(path, { method: "POST", body: JSON.stringify(body) });
    if (r.ok) { setMsg(`${label} ثبت شد.`); await load(); } else setError(r.error?.message ?? "خطا");
  };

  const openHistory = async (id: string) => {
    const r = await call<{ check: { transitions: Array<{ version: number; fromStatus: string | null; toStatus: string; createdAt: string; reason: string | null }> } }>(`/admin/checks/${id}`);
    if (r.ok && r.data) setHistory({ id, transitions: r.data.check.transitions });
    else setError(r.error?.message ?? "خطا");
  };

  const submitCreate = async () => {
    setError(null); setMsg(null);
    if (!form.number.trim() || !form.bankName.trim() || !form.dueDate || !Number(form.amount)) {
      setError("شماره چک، بانک، سررسید و مبلغ الزامی‌اند.");
      return;
    }
    const body: Record<string, unknown> = {
      direction: form.direction,
      number: form.number.trim(),
      bankName: form.bankName.trim(),
      amount: Number(form.amount),
      dueDate: new Date(form.dueDate).toISOString(),
      issueDate: form.issueDate ? new Date(form.issueDate).toISOString() : undefined,
      branch: form.branch || undefined,
      accountNo: form.accountNo || undefined,
      notes: form.notes || undefined,
    };
    if (form.direction === "RECEIVED") {
      if (!form.customerId.trim()) { setError("چک دریافتی باید customerId مشتری داشته باشد."); return; }
      body.customerId = form.customerId.trim();
    } else {
      if (!form.supplierId.trim()) { setError("چک صادره باید supplierId تامین‌کننده داشته باشد."); return; }
      body.supplierId = form.supplierId.trim();
    }
    const r = await call<Record<string, unknown>>("/admin/checks", { method: "POST", body: JSON.stringify(body) });
    if (r.ok) {
      setMsg("چک ثبت شد.");
      setShowCreate(false);
      setForm({ direction: form.direction, number: "", bankName: "", branch: "", accountNo: "", amount: "", dueDate: "", issueDate: "", customerId: "", supplierId: "", notes: "" });
      await load();
    } else setError(r.error?.message ?? "خطا در ثبت چک");
  };

  const ACTION_FA: Record<string, string> = {
    CLEARED: "وصول", BOUNCED: "ثبت برگشت", CANCELLED: "ابطال", DEPOSITED: "ثبت سپرده", PRESENTED: "ثبت ارائه", RETURNED: "عودت",
  };

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-bold">چک‌ها</h2>
        <button onClick={() => setShowCreate((s) => !s)} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-black text-on-accent">
          + ثبت چک
        </button>
      </div>

      {/* Tabs — بخش ۱۱ */}
      <div className="mb-3 flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`h-8 rounded-full px-3 text-xs font-bold ${tab === t.key ? "bg-ink text-on-accent" : "border border-line text-ink/60"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {showCreate ? (
        <div className="mb-4 rounded-xl border border-line p-4">
          <div className="mb-2 flex gap-2">
            <select value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value as "RECEIVED" | "ISSUED" })} className="h-9 rounded-xl border border-line bg-surface px-2 text-xs font-bold">
              <option value="RECEIVED">چک دریافتی (از مشتری)</option>
              <option value="ISSUED">چک صادره (به تامین‌کننده)</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <input value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="شماره چک *" className="h-9 rounded-xl border border-line px-2 text-xs" />
            <input value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} placeholder="بانک *" className="h-9 rounded-xl border border-line px-2 text-xs" />
            <input value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} placeholder="شعبه" className="h-9 rounded-xl border border-line px-2 text-xs" />
            <input value={form.accountNo} onChange={(e) => setForm({ ...form, accountNo: e.target.value })} placeholder="شماره حساب" dir="ltr" className="h-9 rounded-xl border border-line px-2 text-xs" />
            <input value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} type="number" min={0} placeholder="مبلغ *" className="h-9 rounded-xl border border-line px-2 text-xs tabular-nums" />
            <input value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} type="date" className="h-9 rounded-xl border border-line px-2 text-xs" />
            <input value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} type="date" className="h-9 rounded-xl border border-line px-2 text-xs" />
            {form.direction === "RECEIVED" ? (
              <input value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })} placeholder="شناسه مشتری *" dir="ltr" className="h-9 rounded-xl border border-line px-2 text-xs" />
            ) : (
              <input value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} placeholder="شناسه تامین‌کننده *" dir="ltr" className="h-9 rounded-xl border border-line px-2 text-xs" />
            )}
          </div>
          <div className="mt-2 flex gap-2">
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="یادداشت" className="h-9 flex-1 rounded-xl border border-line px-2 text-xs" />
            <button onClick={() => void submitCreate()} disabled={loading} className="h-9 rounded-xl bg-primary px-4 text-xs font-black text-on-accent disabled:opacity-50">ثبت</button>
          </div>
        </div>
      ) : null}

      {msg && <div className="mb-2 text-xs font-bold text-app-ok">{msg}</div>}
      {error && <div className="mb-2 text-xs font-bold text-app-err">{error}</div>}

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--muted)]/40">
            <tr>
              <th className="p-2 text-right">شماره</th>
              <th className="p-2 text-right">وضعیت</th>
              <th className="p-2 text-right">مبلغ</th>
              <th className="p-2 text-right">سررسید</th>
              <th className="p-2 text-right">بانک</th>
              <th className="p-2 text-right">طرف حساب</th>
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
                  <td className="p-2">{STATUS_FA[c.status] ?? c.status}</td>
                  <td className="p-2 tabular-nums">{fa(c.amount)}</td>
                  <td className="p-2">{new Date(c.dueDate).toLocaleDateString("fa-IR")}</td>
                  <td className="p-2">{c.bankName}</td>
                  <td className="p-2">{party}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {live && c.status === "RECEIVED" && (
                        <button disabled={loading} onClick={() => void act(c.id, "transition", "DEPOSITED")} className="rounded border border-[var(--border)] px-1.5 py-0.5">سپرده به بانک</button>
                      )}
                      {live && (c.status === "RECEIVED" || c.status === "DEPOSITED") && (
                        <button disabled={loading} onClick={() => void act(c.id, "clear")} className="rounded border border-[var(--border)] px-1.5 py-0.5">وصول</button>
                      )}
                      {live && c.status === "ISSUED" && (
                        <button disabled={loading} onClick={() => void act(c.id, "transition", "PRESENTED")} className="rounded border border-[var(--border)] px-1.5 py-0.5">ارائه به بانک</button>
                      )}
                      {live && (
                        <button disabled={loading} onClick={() => void act(c.id, "bounce")} className="rounded border border-red-400/60 px-1.5 py-0.5 text-red-600">برگشت</button>
                      )}
                      {live && c.direction === "ISSUED" && (
                        <button disabled={loading} onClick={() => void act(c.id, "cancel")} className="rounded border border-[var(--border)] px-1.5 py-0.5">ابطال</button>
                      )}
                      <button onClick={() => void openHistory(c.id)} className="rounded border border-[var(--border)] px-1.5 py-0.5">تاریخچه</button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {(items ?? []).length === 0 && (
              <tr><td className="p-3 text-[var(--muted)]" colSpan={7}>چکی در این وضعیت نیست.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {history && (
        <div className="mt-2 rounded-xl border border-[var(--border)] p-3 text-xs">
          <div className="mb-1 flex justify-between">
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
