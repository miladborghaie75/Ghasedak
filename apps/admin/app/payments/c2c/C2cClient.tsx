"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import { can } from "@/lib/session";

/**
 * کلاینتِ رسیدهای کارت‌به‌کارت — صف تصمیم (تأیید/رد/اصلاح)، کارت‌های فروشگاه
 * و سوییچ روشن/خاموش روش (بند ۴۸ و تصمیم #۱۴).
 * مجوزها: payments.view دیدن، payments.verify تصمیم، payments.manage کارت‌ها/سوییچ.
 */

interface SubmissionRow {
  id: string;
  state: string;
  amount: string;
  referenceNo: string | null;
  transferDate: string | null;
  transferTime: string | null;
  sourceBank: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  destAccount: { bankName: string; cardMasked: string };
  order: { code: string; customerName: string | null; mobile: string | null } | null;
}

interface AccountRow {
  id: string;
  bankName: string;
  holderName: string;
  cardNumber: string;
  iban: string | null;
  displayTitle: string | null;
  active: boolean;
  sortOrder: number;
}

const STATE_FA: Record<string, string> = {
  PENDING_VERIFICATION: "در انتظار بررسی",
  UNDER_REVIEW: "در حال بررسی",
  APPROVED: "تأییدشده",
  REJECTED: "ردشده",
  CORRECTION_REQUIRED: "نیازمند اصلاح",
  EXPIRED: "منقضی‌شده",
  CANCELLED: "لغوشده",
};

/** وضعیت‌هایی که هنوز قابل تصمیم‌اند — هماهنگ با SUBMISSION_DECIDABLE سرویس */
const DECIDABLE = new Set(["PENDING_VERIFICATION", "UNDER_REVIEW", "CORRECTION_REQUIRED"]);

const STATE_FILTERS: Array<{ key: string; label: string }> = [
  { key: "", label: "همه" },
  { key: "PENDING_VERIFICATION", label: "در انتظار بررسی" },
  { key: "CORRECTION_REQUIRED", label: "نیازمند اصلاح" },
  { key: "APPROVED", label: "تأییدشده" },
  { key: "REJECTED", label: "ردشده" },
  { key: "EXPIRED", label: "منقضی‌شده" },
];

const EMPTY_ACCOUNT = { bankName: "", holderName: "", cardNumber: "", iban: "", displayTitle: "" };

export default function C2cClient() {
  const { call, loading, permissions } = useAdminApi();
  const canVerify = can(permissions, "payments.verify");
  const canManage = can(permissions, "payments.manage");

  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [stateFilter, setStateFilter] = useState("");
  const [stats, setStats] = useState<{ pending: number; approved: number; rejected: number } | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [accountDraft, setAccountDraft] = useState(EMPTY_ACCOUNT);
  const [decision, setDecision] = useState<{ id: string; action: "REJECT" | "CORRECTION"; note: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState<string | null>(null);

  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(""), 3000);
  };

  const load = async () => {
    const q = stateFilter ? `&state=${stateFilter}` : "";
    const [list, st, cfg, acc] = await Promise.all([
      call<{ items: SubmissionRow[]; total: number }>(`/admin/c2c/list?page=1${q}`),
      call<{ pending: number; approved: number; rejected: number }>("/admin/c2c/stats"),
      call<{ enabled: boolean }>("/admin/c2c/settings"),
      call<{ items: AccountRow[] }>("/admin/c2c/accounts"),
    ]);
    if (list.ok && list.data) {
      setRows(list.data.items);
      setTotal(list.data.total);
      setError(null);
    } else {
      setError(list.error?.message ?? "خطا در دریافت رسیدها");
    }
    if (st.ok && st.data) setStats(st.data);
    if (cfg.ok && cfg.data) setEnabled(cfg.data.enabled);
    if (acc.ok && acc.data) setAccounts(acc.data.items);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateFilter]);

  const decide = async (id: string, action: "APPROVE" | "REJECT" | "CORRECTION", note?: string) => {
    const r = await call(`/admin/c2c/${id}/decision`, {
      method: "POST",
      body: JSON.stringify({ action, note: note || undefined }),
    });
    if (r.ok) {
      flash(action === "APPROVE" ? "رسید تأیید و سفارش نهایی شد ✅" : action === "REJECT" ? "رسید رد شد" : "اصلاح از مشتری خواسته شد");
      setDecision(null);
      await load();
    } else {
      flash(r.error?.message ?? "خطا در ثبت تصمیم");
    }
  };

  const toggleEnabled = async () => {
    const r = await call<{ enabled: boolean }>("/admin/c2c/settings", { method: "PATCH", body: JSON.stringify({ enabled: !enabled }) });
    if (r.ok && r.data) {
      setEnabled(r.data.enabled);
      flash(r.data.enabled ? "روش کارت‌به‌کارت روشن شد ✅" : "روش کارت‌به‌کارت خاموش شد");
    } else {
      flash(r.error?.message ?? "خطا");
    }
  };

  const createAccount = async () => {
    const r = await call("/admin/c2c/accounts", { method: "POST", body: JSON.stringify({ ...accountDraft, active: true }) });
    if (r.ok) {
      setAccountDraft(EMPTY_ACCOUNT);
      flash("کارت اضافه شد ✅");
      await load();
    } else {
      flash(r.error?.message ?? "خطا در افزودن کارت");
    }
  };

  const toggleAccount = async (a: AccountRow) => {
    const r = await call(`/admin/c2c/accounts/${a.id}`, { method: "PATCH", body: JSON.stringify({ active: !a.active }) });
    if (r.ok) await load();
    else flash(r.error?.message ?? "خطا");
  };

  const deleteAccount = async (a: AccountRow) => {
    const r = await call(`/admin/c2c/accounts/${a.id}`, { method: "DELETE" });
    if (r.ok) {
      flash("کارت حذف شد");
      await load();
    } else {
      flash(r.error?.message ?? "خطا در حذف کارت");
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-err">{error}</p> : null}
      {msg ? <p className="rounded-xl bg-app-primary-soft px-4 py-2 text-xs font-bold text-app-ok">{msg}</p> : null}

      {/* خلاصه + سوییچ روش */}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-xs">
        <span className="font-bold">در انتظار: <span className="tabular-nums text-app-warning">{fa(stats?.pending ?? 0)}</span></span>
        <span className="font-bold">تأییدشده: <span className="tabular-nums text-app-ok">{fa(stats?.approved ?? 0)}</span></span>
        <span className="font-bold">ردشده: <span className="tabular-nums text-app-err">{fa(stats?.rejected ?? 0)}</span></span>
        {canManage && enabled !== null ? (
          <button
            type="button"
            onClick={toggleEnabled}
            disabled={loading}
            className={`ms-auto rounded-full px-4 py-1.5 text-xs font-bold ${enabled ? "bg-app-ok/15 text-app-ok" : "bg-ink/10 text-ink/60"}`}
          >
            {enabled ? "روش فعال است — خاموش کن" : "روش خاموش است — روشن کن"}
          </button>
        ) : null}
      </div>

      {/* فیلتر وضعیت */}
      <div className="flex flex-wrap gap-2">
        {STATE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setStateFilter(f.key)}
            className={`rounded-full px-3 py-1 text-xs font-bold ${stateFilter === f.key ? "bg-ink text-surface" : "bg-ink/5 text-ink/70"}`}
          >
            {f.label}
          </button>
        ))}
        <span className="ms-auto self-center text-xs text-ink/50">{fa(total)} رسید</span>
      </div>

      {/* صف رسیدها */}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <div className="admin-table-wrap"><table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">سفارش</th><th className="px-4 py-3">مشتری</th>
              <th className="px-4 py-3">مبلغ</th><th className="px-4 py-3">ارجاع</th>
              <th className="px-4 py-3">زمان واریز</th><th className="px-4 py-3">بانک مبدأ</th>
              <th className="px-4 py-3">کارت مقصد</th><th className="px-4 py-3">وضعیت</th>
              <th className="px-4 py-3">تصمیم</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-8 text-center text-ink/50">رسیدی با این فیلتر نیست.</td></tr>
            ) : rows.map((s) => (
              <tr key={s.id} className="border-b border-line/60 align-top last:border-0">
                <td className="px-4 py-3 font-bold" dir="ltr">{s.order?.code ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {s.order?.customerName ?? "—"}
                  {s.order?.mobile ? <span className="block text-ink/50" dir="ltr">{s.order.mobile}</span> : null}
                </td>
                <td className="px-4 py-3 tabular-nums font-bold">{fa(s.amount)}</td>
                <td className="px-4 py-3 text-xs" dir="ltr">{s.referenceNo ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-ink/60">
                  {s.transferDate ? <span dir="ltr">{s.transferDate}{s.transferTime ? ` ${s.transferTime}` : ""}</span> : "—"}
                </td>
                <td className="px-4 py-3 text-xs">{s.sourceBank ?? "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {s.destAccount.bankName}
                  <span className="block text-ink/50" dir="ltr">{s.destAccount.cardMasked}</span>
                </td>
                <td className="px-4 py-3 text-xs">
                  <span className={s.state === "APPROVED" ? "font-bold text-app-ok" : s.state === "REJECTED" ? "font-bold text-app-err" : DECIDABLE.has(s.state) ? "font-bold text-app-warning" : "text-ink/60"}>
                    {STATE_FA[s.state] ?? s.state}
                  </span>
                  {s.decisionNote ? <span className="mt-1 block text-ink/50">{s.decisionNote}</span> : null}
                  {s.decidedBy ? <span className="block text-ink/40">توسط {s.decidedBy}</span> : null}
                </td>
                <td className="px-4 py-3">
                  {canVerify && DECIDABLE.has(s.state) ? (
                    <div className="flex flex-col gap-1.5">
                      <button type="button" onClick={() => decide(s.id, "APPROVE")} className="rounded-lg bg-app-ok/15 px-3 py-1 text-xs font-bold text-app-ok">
                        تأیید
                      </button>
                      <button type="button" onClick={() => setDecision({ id: s.id, action: "REJECT", note: "" })} className="rounded-lg bg-app-err/10 px-3 py-1 text-xs font-bold text-app-err">
                        رد
                      </button>
                      <button type="button" onClick={() => setDecision({ id: s.id, action: "CORRECTION", note: "" })} className="rounded-lg bg-ink/5 px-3 py-1 text-xs font-bold text-ink/70">
                        درخواست اصلاح
                      </button>
                      {decision?.id === s.id ? (
                        <div className="mt-1 flex flex-col gap-1.5">
                          <textarea
                            value={decision.note}
                            onChange={(e) => setDecision({ ...decision, note: e.target.value })}
                            placeholder={decision.action === "REJECT" ? "دلیل رد (برای پیامک مشتری)" : "چه چیزی باید اصلاح شود؟"}
                            rows={2}
                            className="w-full rounded-lg border border-line bg-background px-2 py-1 text-xs"
                          />
                          <div className="flex gap-1.5">
                            <button type="button" onClick={() => decide(s.id, decision.action, decision.note)} className="rounded-lg bg-ink px-3 py-1 text-xs font-bold text-surface">
                              ثبت {decision.action === "REJECT" ? "رد" : "اصلاح"}
                            </button>
                            <button type="button" onClick={() => setDecision(null)} className="rounded-lg bg-ink/5 px-3 py-1 text-xs font-bold text-ink/60">
                              انصراف
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-xs text-ink/40">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {/* کارت‌های فروشگاه */}
      <section className="rounded-card border border-line bg-surface p-4">
        <h2 className="mb-3 text-sm font-black">کارت‌های فروشگاه</h2>
        {accounts.length === 0 ? (
          <p className="text-xs text-ink/50">هنوز کارتی ثبت نشده است.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line/60">
            {accounts.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 py-2.5 text-xs">
                <span className="font-bold">{a.displayTitle || a.bankName}</span>
                <span dir="ltr" className="text-ink/70">{a.holderName}</span>
                <span dir="ltr" className="tabular-nums text-ink/70">{a.cardNumber}</span>
                {a.iban ? <span dir="ltr" className="text-ink/50">{a.iban}</span> : null}
                <span className={`rounded-full px-2 py-0.5 font-bold ${a.active ? "bg-app-ok/15 text-app-ok" : "bg-ink/10 text-ink/50"}`}>
                  {a.active ? "فعال" : "غیرفعال"}
                </span>
                {canManage ? (
                  <span className="ms-auto flex gap-1.5">
                    <button type="button" onClick={() => toggleAccount(a)} className="rounded-lg bg-ink/5 px-3 py-1 font-bold text-ink/70">
                      {a.active ? "غیرفعال کن" : "فعال کن"}
                    </button>
                    <button type="button" onClick={() => deleteAccount(a)} className="rounded-lg bg-app-err/10 px-3 py-1 font-bold text-app-err">
                      حذف
                    </button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canManage ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-xs">
            <input value={accountDraft.bankName} onChange={(e) => setAccountDraft({ ...accountDraft, bankName: e.target.value })} placeholder="بانک" className="w-28 rounded-lg border border-line bg-background px-2 py-1.5" />
            <input value={accountDraft.holderName} onChange={(e) => setAccountDraft({ ...accountDraft, holderName: e.target.value })} placeholder="به نام" className="w-32 rounded-lg border border-line bg-background px-2 py-1.5" />
            <input value={accountDraft.cardNumber} onChange={(e) => setAccountDraft({ ...accountDraft, cardNumber: e.target.value })} placeholder="شماره کارت" dir="ltr" className="w-44 rounded-lg border border-line bg-background px-2 py-1.5 tabular-nums" />
            <input value={accountDraft.iban} onChange={(e) => setAccountDraft({ ...accountDraft, iban: e.target.value })} placeholder="شبا (اختیاری)" dir="ltr" className="w-52 rounded-lg border border-line bg-background px-2 py-1.5 tabular-nums" />
            <input value={accountDraft.displayTitle} onChange={(e) => setAccountDraft({ ...accountDraft, displayTitle: e.target.value })} placeholder="عنوان نمایش (اختیاری)" className="w-36 rounded-lg border border-line bg-background px-2 py-1.5" />
            <button type="button" onClick={createAccount} disabled={loading} className="rounded-lg bg-ink px-4 py-1.5 font-bold text-surface">
              افزودن کارت
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
