"use client";

import { useCallback, useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

/**
 * فاز ۹ — Wave 3 (STEP 2): تأیید وصول چک از روی صورتحساب بانکی.
 * میزبانش صفحهٔ خزانهٔ موجود است — هیچ sidebar جدیدی ساخته نمی‌شود.
 *
 * اصل Match ≠ Clear:
 *  - MATCH فقط association است (BankStatementMatch) و اینجا نمایش داده می‌شود.
 *  - CLEAR یک lifecycle transition + سند حسابداری + اثر خزانه است و فقط با
 *    confirm صریح از endpoint دامنهٔ چک (checks.clear / checks.manage) اجرا می‌شود.
 *  - چکِ وصول‌شده action ندارد (disabled) — هیچ سند دومی ساخته نمی‌شود.
 */

interface CheckInfo {
  id: string;
  direction: string;
  status: string;
  number: string;
  bankName: string;
  amount: string;
  dueDate: string;
  lifecycleVersion: number;
  partyName: string | null;
  clearedBefore: boolean;
  canClear: boolean;
  matchId: string;
}

interface Row {
  statementId: string;
  date: string;
  amount: string;
  description: string | null;
  check: CheckInfo | null;
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

export default function StatementChecks({ bankAccountId }: { bankAccountId: string }) {
  const { call, loading, permissions } = useAdminApi();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busyStmt, setBusyStmt] = useState<string | null>(null);

  const canViewChecks = (permissions ?? []).includes("checks.view");
  const canClear = (permissions ?? []).includes("checks.clear");

  const load = useCallback(async () => {
    setError(null);
    setMsg(null);
    const r = await call<{ items: Array<{ id: string; date: string; amount: string; description: string | null; matches: Array<{ sourceType: string; sourceId: string }> }> }>(
      `/admin/treasury/bank-accounts/${bankAccountId}/statements`,
    );
    if (!r.ok || !r.data) {
      setRows(null);
      setError(r.error?.message ?? "خطا");
      return;
    }
    // برای ردیف‌های matched-to-check، وضعیت چک از endpoint read-only دامنهٔ خزانه خوانده می‌شود
    const out: Row[] = [];
    for (const s of r.data.items) {
      const cm = s.matches.find((m) => m.sourceType === "check");
      if (!cm) {
        out.push({ statementId: s.id, date: s.date, amount: s.amount, description: s.description, check: null });
        continue;
      }
      const cr = await call<{ matched: boolean; check: CheckInfo | null }>(`/admin/treasury/bank-accounts/${bankAccountId}/statements/${s.id}/check`);
      out.push({ statementId: s.id, date: s.date, amount: s.amount, description: s.description, check: cr.ok && cr.data ? cr.data.check : null });
    }
    setRows(out);
  }, [bankAccountId, call]);

  useEffect(() => {
    void load();
  }, [load]);

  /** وصول با confirm صریح — شماره/مبلغ/طرف حساب/بانک/تاریخ + توضیح اثر مالی */
  const clearFromStatement = async (row: Row) => {
    const c = row.check;
    if (!c) return;
    const finEffect =
      c.direction === "RECEIVED"
        ? "بانک +، چک دریافتی − و تسویه مطالبهٔ مشتری"
        : "بانک − و تسویه بدهی چک صادره";
    const ok = window.confirm(
      [
        `تأیید وصول چک از صورتحساب بانکی`,
        `— شماره چک: ${c.number}`,
        `— مبلغ: ${fa(c.amount)} تومان`,
        `— طرف حساب: ${c.partyName ?? "—"}`,
        `— بانک: ${c.bankName}`,
        `— سررسید: ${new Date(c.dueDate).toLocaleDateString("fa-IR")}`,
        `— اثر مالی: ${finEffect} (سند حسابداری ثبت می‌شود؛ قابل برگشت نیست).`,
        `ادامه؟`,
      ].join("\n"),
    );
    if (!ok) return;
    setError(null);
    setMsg(null);
    setBusyStmt(row.statementId);
    try {
      // Clear صریح روی endpoint دامنهٔ چک — treasury فقط نمایش‌دهنده است (Match ≠ Clear)
      const r = await call<Record<string, unknown>>(`/admin/checks/${c.id}/clear`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: `stmt-clear:${c.id}:${row.statementId}`, bankStatementId: row.statementId }),
      });
      if (r.ok) {
        setMsg(`وصول چک ${c.number} ثبت شد — سند حسابداری و مانده بانک به‌روز شد.`);
        await load();
      } else {
        setError(r.error?.message ?? "خطا");
      }
    } finally {
      setBusyStmt(null);
    }
  };

  if (!canViewChecks) {
    return (
      <div className="border-t border-[var(--border)] pt-3">
        <h3 className="font-bold text-sm mb-2">چک‌های متصل به صورتحساب</h3>
        <div className="text-xs text-[var(--muted)]">برای نمایش وضعیت چک‌ها دسترسی «مشاهده چک‌ها» لازم است.</div>
      </div>
    );
  }

  const checkRows = (rows ?? []).filter((r) => r.check);
  return (
    <div className="border-t border-[var(--border)] pt-3">
      <h3 className="font-bold text-sm mb-2">چک‌های متصل به صورتحساب بانکی — تأیید وصول</h3>
      {msg && <div className="text-xs text-emerald-600 mb-2">{msg}</div>}
      {error && <div className="text-xs text-red-600 mb-2">{error}</div>}
      {rows === null ? (
        <div className="text-xs text-[var(--muted)]">در حال بارگذاری…</div>
      ) : checkRows.length === 0 ? (
        <div className="text-xs text-[var(--muted)]">هیچ ردیف صورتحسابی به چک تطبیق داده نشده — تطبیق فقط association است و خودش چک را وصول نمی‌کند.</div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
          <div className="admin-table-wrap"><table className="w-full text-xs">
            <thead className="bg-[var(--muted)]/40">
              <tr>
                <th className="p-1.5 text-right">تاریخ صورتحساب</th>
                <th className="p-1.5 text-right">مبلغ</th>
                <th className="p-1.5 text-right">چک</th>
                <th className="p-1.5 text-right">وضعیت چک</th>
                <th className="p-1.5 text-right">طرف حساب</th>
                <th className="p-1.5 text-right">عملیات</th>
              </tr>
            </thead>
            <tbody>
              {checkRows.map((r) => {
                const c = r.check!;
                return (
                  <tr key={r.statementId} className="border-t border-[var(--border)]">
                    <td className="p-1.5" dir="ltr">{new Date(r.date).toLocaleDateString("fa-IR")}</td>
                    <td className="p-1.5">{fa(r.amount)}</td>
                    <td className="p-1.5" dir="ltr">{c.number} <span className="text-[var(--muted)]">({c.bankName})</span></td>
                    <td className="p-1.5">{STATUS_FA[c.status] ?? c.status}</td>
                    <td className="p-1.5">{c.partyName ?? "—"}</td>
                    <td className="p-1.5">
                      {c.status === "CLEARED" ? (
                        <span className="text-[var(--muted)]">وصول‌شده — عملیات ندارد</span>
                      ) : c.canClear && c.direction === "RECEIVED" ? (
                        <button
                          disabled={loading || busyStmt === r.statementId || !canClear}
                          title={canClear ? undefined : "دسترسی وصول چک را نداری"}
                          onClick={() => void clearFromStatement(r)}
                          className="rounded border border-emerald-500/60 text-emerald-700 px-1.5 py-0.5 hover:bg-emerald-500/10 disabled:opacity-50"
                        >
                          {busyStmt === r.statementId ? "در حال ثبت…" : "تأیید وصول"}
                        </button>
                      ) : (
                        <span className="text-[var(--muted)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      )}
    </div>
  );
}
