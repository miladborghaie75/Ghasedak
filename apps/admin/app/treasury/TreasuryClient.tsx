"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";
import ChecksWorkspace from "./ChecksWorkspace";
import StatementChecks from "./StatementChecks";

interface CashRow { id: string; kind: string; name: string; glCode: string; glName: string; openingBalance: string; currentBalance: string; glBookBalance: string; }
interface BankRow { id: string; name: string; bankName: string; accountNumber: string; iban: string | null; glCode: string; glName: string; openingBalance: string; currentBalance: string; glBookBalance: string; }
interface OpenShift { id: string; register: string; cashier: string; openingCash: string; expenseTotal: string; openedAt: string; }
interface DueCheck { id: string; direction: string; status: string; number: string; bankName: string; amount: string; dueDate: string; }
interface Summary { cashTotal: string; bankTotal: string; total: string; openShifts: OpenShift[]; dueChecks: DueCheck[]; }
interface Accounts { cash: CashRow[]; bank: BankRow[]; }
interface Stmt { id: string; date: string; amount: string; description: string | null; matchedPaymentId: string | null; }
interface Recon { book: string; statement: string; difference: string; statementCount: number; }

const KIND_FA: Record<string, string> = { cash: "نقد", bank: "بانکی", card_settlement: "تسویه کارت", online_gateway: "درگاه آنلاین", petty: "تن‌خواه" };

export default function TreasuryClient() {
  const { call, loading } = useAdminApi();
  const [accounts, setAccounts] = useState<Accounts | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [sel, setSel] = useState<{ type: "cash" | "bank"; id: string; name: string } | null>(null);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [stmts, setStmts] = useState<Stmt[] | null>(null);
  const [recon, setRecon] = useState<Recon | null>(null);

  const load = async () => {
    const [a, s] = await Promise.all([
      call<Accounts>("/admin/treasury/accounts"),
      call<Summary>("/admin/treasury/summary"),
    ]);
    if (a.ok && a.data) setAccounts(a.data); else setError(a.error?.message ?? "خطا");
    if (s.ok && s.data) setSummary(s.data); else setError(s.error?.message ?? "خطا");
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const act = async (path: string, body: object, okMsg: string) => {
    setError(null);
    setMsg(null);
    const r = await call<{ ok?: boolean; number?: string; balance?: string }>(path, { method: "POST", body: JSON.stringify(body) });
    if (r.ok) {
      setMsg(r.data?.number ? `${okMsg} — سند ${r.data.number}${r.data.balance ? ` — مانده: ${fa(r.data.balance)}` : ""}` : okMsg);
      setAmount("");
      setDesc("");
      await load();
    } else {
      setError(r.error?.message ?? "خطا");
    }
  };

  const openBank = async (row: BankRow) => {
    setSel({ type: "bank", id: row.id, name: row.name });
    setTransferTo("");
    const r = await call<{ items: Stmt[]; reconciliation: Recon }>(`/admin/treasury/bank-accounts/${row.id}/statements`);
    if (r.ok && r.data) { setStmts(r.data.items); setRecon(r.data.reconciliation); } else { setStmts(null); setRecon(null); }
  };

  const openCash = (row: CashRow) => {
    setSel({ type: "cash", id: row.id, name: row.name });
    setStmts(null);
    setRecon(null);
  };

  const allAccounts = [
    ...(accounts?.cash ?? []).map((c) => ({ key: `cash:${c.id}`, type: "cash" as const, id: c.id, label: `${c.name} (${c.glCode})`, row: c })),
    ...(accounts?.bank ?? []).map((b) => ({ key: `bank:${b.id}`, type: "bank" as const, id: b.id, label: `${b.name} — ${b.bankName} (${b.glCode})`, row: b })),
  ];

  return (
    <div className="space-y-6">
      {summary && (
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-sm text-[var(--muted)]">جمع صندوق‌ها</div>
            <div className="text-2xl font-bold">{fa(summary.cashTotal)} تومان</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-sm text-[var(--muted)]">جمع بانک</div>
            <div className="text-2xl font-bold">{fa(summary.bankTotal)} تومان</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="text-sm text-[var(--muted)]">موجودی خزانه</div>
            <div className="text-2xl font-bold">{fa(summary.total)} تومان</div>
          </div>
        </div>
      )}

      {error && <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-300 p-3 text-sm">{error}</div>}
      {msg && <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 p-3 text-sm">{msg}</div>}

      {/* صندوق‌های نقد */}
      <section>
        <h2 className="font-bold mb-2">صندوق‌های نقد</h2>
        <div className="rounded-xl border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)]/40">
              <tr>
                <th className="p-2 text-right">نام</th>
                <th className="p-2 text-right">نوع</th>
                <th className="p-2 text-right">GL</th>
                <th className="p-2 text-right">مانده جاری</th>
                <th className="p-2 text-right">مانده دفتری</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(accounts?.cash ?? []).map((c) => (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="p-2">{c.name}</td>
                  <td className="p-2">{KIND_FA[c.kind] ?? c.kind}</td>
                  <td className="p-2">{c.glCode} — {c.glName}</td>
                  <td className="p-2 font-bold">{fa(c.currentBalance)}</td>
                  <td className="p-2 text-[var(--muted)]">{fa(c.glBookBalance)}</td>
                  <td className="p-2">
                    <button className="text-xs rounded-lg border border-[var(--border)] px-2 py-1 hover:bg-[var(--muted)]/40" onClick={() => openCash(c)}>
                      عملیات
                    </button>
                  </td>
                </tr>
              ))}
              {(accounts?.cash ?? []).length === 0 && <tr><td className="p-3 text-[var(--muted)]" colSpan={6}>صندوقی ثبت نشده است.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* حساب‌های بانکی */}
      <section>
        <h2 className="font-bold mb-2">حساب‌های بانکی</h2>
        <div className="rounded-xl border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)]/40">
              <tr>
                <th className="p-2 text-right">نام</th>
                <th className="p-2 text-right">بانک</th>
                <th className="p-2 text-right">شماره حساب</th>
                <th className="p-2 text-right">GL</th>
                <th className="p-2 text-right">مانده جاری</th>
                <th className="p-2 text-right">مانده دفتری</th>
                <th className="p-2"></th>
              </tr>
            </thead>
            <tbody>
              {(accounts?.bank ?? []).map((b) => (
                <tr key={b.id} className="border-t border-[var(--border)]">
                  <td className="p-2">{b.name}</td>
                  <td className="p-2">{b.bankName}</td>
                  <td className="p-2" dir="ltr">{b.accountNumber}</td>
                  <td className="p-2">{b.glCode} — {b.glName}</td>
                  <td className="p-2 font-bold">{fa(b.currentBalance)}</td>
                  <td className="p-2 text-[var(--muted)]">{fa(b.glBookBalance)}</td>
                  <td className="p-2">
                    <button className="text-xs rounded-lg border border-[var(--border)] px-2 py-1 hover:bg-[var(--muted)]/40" onClick={() => openBank(b)}>
                      عملیات / صورتحساب
                    </button>
                  </td>
                </tr>
              ))}
              {(accounts?.bank ?? []).length === 0 && <tr><td className="p-3 text-[var(--muted)]" colSpan={7}>حساب بانکی ثبت نشده است.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {/* عملیات حساب انتخاب‌شده */}
      {sel && (
        <section className="rounded-xl border border-[var(--border)] p-4 space-y-3">
          <h2 className="font-bold">عملیات: {sel.name}</h2>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm">
              مبلغ (تومان)
              <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="block mt-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 w-40" />
            </label>
            <label className="text-sm">
              شرح
              <input value={desc} onChange={(e) => setDesc(e.target.value)} className="block mt-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 w-64" />
            </label>
            <button disabled={loading || !amount} onClick={() => void act("/admin/treasury/cash-in", { accountId: sel.id, amount: Number(amount), description: desc }, "واریز ثبت شد")} className="rounded-lg bg-emerald-600 px-3 py-2 text-white text-sm disabled:opacity-50">
              واریز
            </button>
            <button disabled={loading || !amount} onClick={() => void act("/admin/treasury/cash-out", { accountId: sel.id, amount: Number(amount), description: desc }, "برداشت ثبت شد")} className="rounded-lg bg-red-600 px-3 py-2 text-white text-sm disabled:opacity-50">
              برداشت
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
            <label className="text-sm">
              انتقال به
              <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className="block mt-1 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 w-64">
                <option value="">— انتخاب مقصد —</option>
                {allAccounts.filter((a) => a.id !== sel.id).map((a) => (
                  <option key={a.key} value={a.id}>{a.label}</option>
                ))}
              </select>
            </label>
            <button
              disabled={loading || !amount || !transferTo}
              onClick={() => void act("/admin/treasury/transfer", { fromId: sel.id, toId: transferTo, amount: Number(amount), description: desc }, "انتقال ثبت شد")}
              className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-50"
            >
              انتقال بین حساب‌ها
            </button>
          </div>

          {/* صورتحساب بانکی */}
          {sel.type === "bank" && (
            <div className="border-t border-[var(--border)] pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-sm">صورتحساب بانک و مغایرت‌گیری</h3>
                <button
                  disabled={loading}
                  onClick={async () => {
                    const r = await call<{ matched: number }>(`/admin/treasury/bank-accounts/${sel.id}/statements/auto-match`, { method: "POST", body: JSON.stringify({}) });
                    if (r.ok && r.data) setMsg(`تطبیق خودکار: ${fa(r.data.matched)} ردیف منطبق شد`);
                    else setError(r.error?.message ?? "خطا");
                    await openBank({ id: sel.id, name: sel.name } as BankRow);
                  }}
                  className="text-xs rounded-lg border border-[var(--border)] px-2 py-1 hover:bg-[var(--muted)]/40"
                >
                  تطبیق خودکار با پرداخت‌ها
                </button>
              </div>
              {recon && (
                <div className="text-sm flex flex-wrap gap-4 rounded-lg bg-[var(--muted)]/30 p-3">
                  <span>مانده دفتری: <b>{fa(recon.book)}</b></span>
                  <span>جمع صورتحساب: <b>{fa(recon.statement)}</b></span>
                  <span className={recon.difference === "0" ? "text-emerald-600" : "text-red-600"}>
                    مغایرت: <b>{fa(recon.difference)}</b>
                  </span>
                  <span className="text-[var(--muted)]">{fa(recon.statementCount)} ردیف</span>
                </div>
              )}
              <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)]">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--muted)]/40 sticky top-0">
                    <tr><th className="p-1.5 text-right">تاریخ</th><th className="p-1.5 text-right">مبلغ</th><th className="p-1.5 text-right">شرح</th><th className="p-1.5 text-right">تطبیق</th></tr>
                  </thead>
                  <tbody>
                    {(stmts ?? []).map((s) => (
                      <tr key={s.id} className="border-t border-[var(--border)]">
                        <td className="p-1.5" dir="ltr">{new Date(s.date).toLocaleDateString("fa-IR")}</td>
                        <td className="p-1.5">{fa(s.amount)}</td>
                        <td className="p-1.5">{s.description ?? "—"}</td>
                        <td className="p-1.5">{s.matchedPaymentId ? "✅" : "—"}</td>
                      </tr>
                    ))}
                    {(stmts ?? []).length === 0 && <tr><td className="p-2 text-[var(--muted)]" colSpan={4}>ردیفی ثبت نشده — import از API: POST /admin/treasury/bank-accounts/:id/statements/import</td></tr>}
                  </tbody>
                </table>
              </div>

              {/* فاز ۹ — Wave 3 (STEP 2): تأیید وصول چک از صورتحساب — بدون sidebar جدید، همان بخش صورتحساب */}
              {sel && <StatementChecks bankAccountId={sel.id} />}
            </div>
          )}
        </section>
      )}

      {/* شیفت‌های باز و چک‌های نزدیک */}
      <div className="grid grid-cols-2 gap-4">
        <section>
          <h2 className="font-bold mb-2">شیفت‌های باز صندوق</h2>
          <div className="rounded-xl border border-[var(--border)] p-3 text-sm space-y-2">
            {(summary?.openShifts ?? []).map((s) => (
              <div key={s.id} className="flex justify-between gap-2">
                <span>{s.register} — {s.cashier}</span>
                <span className="text-[var(--muted)]">افتتاح {fa(s.openingCash)} · هزینه {fa(s.expenseTotal)}</span>
              </div>
            ))}
            {(summary?.openShifts ?? []).length === 0 && <div className="text-[var(--muted)]">شیفت بازی نیست.</div>}
          </div>
        </section>
        <section>
          <h2 className="font-bold mb-2">چک‌های سرسید نزدیک (۳۰ روز)</h2>
          <div className="rounded-xl border border-[var(--border)] p-3 text-sm space-y-2 max-h-40 overflow-y-auto">
            {(summary?.dueChecks ?? []).map((c) => (
              <div key={c.id} className="flex justify-between gap-2">
                <span dir="ltr">{c.direction === "RECEIVED" ? "دریافتی" : " پرداختی"} {c.number} — {c.bankName}</span>
                <span className="text-[var(--muted)]">{fa(c.amount)} · {new Date(c.dueDate).toLocaleDateString("fa-IR")}</span>
              </div>
            ))}
            {(summary?.dueChecks ?? []).length === 0 && <div className="text-[var(--muted)]">چکی در ۳۰ روز آینده نیست.</div>}
          </div>
        </section>
      </div>

      {/* فاز ۹ — Wave 2: دامنهٔ چک (STEP 13) — همان فضای خزانه، بدون sidebar جدید */}
      <ChecksWorkspace />
    </div>
  );
}
