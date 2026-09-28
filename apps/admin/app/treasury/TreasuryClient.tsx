"use client";

/**
 * فاز ۱۰ — بخش ۱۰/۱۷: بازطراحی IA خزانه.
 * ساختار: Overview (KPIها + اکشن‌های سریع) → Cash Accounts → Bank Accounts → Checks →
 * Statements/Reconciliation (داخل حساب بانکی). خلاصه اول، عملیات دوم، جزئیات سوم.
 * هیچ sidebar جدیدی اضافه نمی‌شود؛ همه قابلیت‌های موجود reuse می‌شوند.
 */

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

type TabKey = "overview" | "cash" | "bank" | "checks";
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "overview", label: "نمای کلی" },
  { key: "cash", label: "صندوق‌ها" },
  { key: "bank", label: "حساب‌های بانکی" },
  { key: "checks", label: "چک‌ها" },
];

export default function TreasuryClient() {
  const { call, loading } = useAdminApi();
  const [tab, setTab] = useState<TabKey>("overview");
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
    } else setError(r.error?.message ?? "خطا");
  };

  const openBank = async (row: BankRow) => {
    setSel({ type: "bank", id: row.id, name: row.name });
    setTab("bank");
    setTransferTo("");
    const r = await call<{ items: Stmt[]; reconciliation: Recon }>(`/admin/treasury/bank-accounts/${row.id}/statements`);
    if (r.ok && r.data) { setStmts(r.data.items); setRecon(r.data.reconciliation); } else { setStmts(null); setRecon(null); }
  };

  const openCash = (row: CashRow) => {
    setSel({ type: "cash", id: row.id, name: row.name });
    setTab("cash");
    setStmts(null);
    setRecon(null);
  };

  const allAccounts = [
    ...(accounts?.cash ?? []).map((c) => ({ key: `cash:${c.id}`, type: "cash" as const, id: c.id, label: `${c.name} (${c.glCode})`, row: c })),
    ...(accounts?.bank ?? []).map((b) => ({ key: `bank:${b.id}`, type: "bank" as const, id: b.id, label: `${b.name} — ${b.bankName} (${b.glCode})`, row: b })),
  ];

  const todayReceipts = Number(summary?.dueChecks.filter((c) => c.direction === "RECEIVED").length ?? 0);

  return (
    <div className="space-y-5">
      {/* Tabs — بخش ۱۰: بدون دامنهٔ sidebar جدید */}
      <div className="flex flex-wrap gap-1">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`h-9 rounded-full px-4 text-xs font-bold ${tab === t.key ? "bg-ink text-on-accent" : "border border-line text-ink/60"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-red-800 dark:text-red-300 p-3 text-sm">{error}</div>}
      {msg && <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 p-3 text-sm">{msg}</div>}

      {/* ---------------- Overview — بخش ۱۰: فقط KPIهای مهم + اکشن‌های سریع ---------------- */}
      {tab === "overview" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="text-xs text-[var(--muted)]">جمع صندوق‌ها</div>
              <div className="text-xl font-black tabular-nums">{fa(summary?.cashTotal ?? "0")}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="text-xs text-[var(--muted)]">جمع بانک</div>
              <div className="text-xl font-black tabular-nums">{fa(summary?.bankTotal ?? "0")}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="text-xs text-[var(--muted)]">موجودی خزانه</div>
              <div className="text-xl font-black tabular-nums">{fa(summary?.total ?? "0")}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="text-xs text-[var(--muted)]">چک‌های سرسید نزدیک</div>
              <div className="text-xl font-black tabular-nums">{fa((summary?.dueChecks ?? []).length)}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="text-xs text-[var(--muted)]">دریافتیِ نزدیک سررسید</div>
              <div className="text-xl font-black tabular-nums">{fa(todayReceipts)}</div>
            </div>
            <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
              <div className="text-xs text-[var(--muted)]">شیفت‌های باز</div>
              <div className="text-xl font-black tabular-nums">{fa((summary?.openShifts ?? []).length)}</div>
            </div>
          </div>

          {/* اکشن‌های سریع — بخش ۱۰: ثبت دریافت/پرداخت/چک/انتقال */}
          <QuickActions allAccounts={allAccounts} onAct={act} loading={loading} />

          <div className="grid gap-4 lg:grid-cols-2">
            <section>
              <h2 className="mb-2 font-bold">شیفت‌های باز صندوق</h2>
              <div className="space-y-2 rounded-xl border border-[var(--border)] p-3 text-sm">
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
              <h2 className="mb-2 font-bold">چک‌های نزدیک سررسید (۳۰ روز)</h2>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-[var(--border)] p-3 text-sm">
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
        </div>
      )}

      {/* ---------------- Cash Accounts ---------------- */}
      {tab === "cash" && (
        <section className="space-y-3">
          <h2 className="font-bold">صندوق‌های نقد</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)]/40">
                <tr><th className="p-2 text-right">نام</th><th className="p-2 text-right">نوع</th><th className="p-2 text-right">GL</th><th className="p-2 text-right">مانده جاری</th><th className="p-2 text-right">مانده دفتری</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {(accounts?.cash ?? []).map((c) => (
                  <tr key={c.id} className="border-t border-[var(--border)]">
                    <td className="p-2">{c.name}</td>
                    <td className="p-2">{KIND_FA[c.kind] ?? c.kind}</td>
                    <td className="p-2">{c.glCode} — {c.glName}</td>
                    <td className="p-2 font-bold">{fa(c.currentBalance)}</td>
                    <td className="p-2 text-[var(--muted)]">{fa(c.glBookBalance)}</td>
                    <td className="p-2"><button className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--muted)]/40" onClick={() => openCash(c)}>عملیات</button></td>
                  </tr>
                ))}
                {(accounts?.cash ?? []).length === 0 && <tr><td className="p-3 text-[var(--muted)]" colSpan={6}>صندوقی ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>
          {/* عملیات حساب انتخاب‌شده */}
          {sel?.type === "cash" && (
            <AccountOps sel={sel} allAccounts={allAccounts} amount={amount} setAmount={setAmount} desc={desc} setDesc={setDesc}
              transferTo={transferTo} setTransferTo={setTransferTo} loading={loading} act={act} />
          )}
        </section>
      )}

      {/* ---------------- Bank Accounts + Statements ---------------- */}
      {tab === "bank" && (
        <section className="space-y-3">
          <h2 className="font-bold">حساب‌های بانکی</h2>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-sm">
              <thead className="bg-[var(--muted)]/40">
                <tr><th className="p-2 text-right">نام</th><th className="p-2 text-right">بانک</th><th className="p-2 text-right">شماره حساب</th><th className="p-2 text-right">GL</th><th className="p-2 text-right">مانده جاری</th><th className="p-2 text-right">مانده دفتری</th><th className="p-2"></th></tr>
              </thead>
              <tbody>
                {(accounts?.bank ?? []).map((b) => (
                  <tr key={b.id} className={`border-t border-[var(--border)] ${sel?.id === b.id ? "bg-primary-soft/40" : ""}`}>
                    <td className="p-2">{b.name}</td>
                    <td className="p-2">{b.bankName}</td>
                    <td className="p-2" dir="ltr">{b.accountNumber}</td>
                    <td className="p-2">{b.glCode} — {b.glName}</td>
                    <td className="p-2 font-bold">{fa(b.currentBalance)}</td>
                    <td className="p-2 text-[var(--muted)]">{fa(b.glBookBalance)}</td>
                    <td className="p-2"><button className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--muted)]/40" onClick={() => void openBank(b)}>صورتحساب / عملیات</button></td>
                  </tr>
                ))}
                {(accounts?.bank ?? []).length === 0 && <tr><td className="p-3 text-[var(--muted)]" colSpan={7}>حساب بانکی ثبت نشده است.</td></tr>}
              </tbody>
            </table>
          </div>

          {sel?.type === "bank" && (
            <>
              <AccountOps sel={sel} allAccounts={allAccounts} amount={amount} setAmount={setAmount} desc={desc} setDesc={setDesc}
                transferTo={transferTo} setTransferTo={setTransferTo} loading={loading} act={act} />
              <div className="space-y-2 rounded-xl border border-[var(--border)] p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold">صورتحساب بانک و مغایرت‌گیری</h3>
                  <button
                    disabled={loading}
                    onClick={async () => {
                      const r = await call<{ matched: number }>(`/admin/treasury/bank-accounts/${sel.id}/statements/auto-match`, { method: "POST", body: JSON.stringify({}) });
                      if (r.ok && r.data) setMsg(`تطبیق خودکار: ${fa(r.data.matched)} ردیف منطبق شد`);
                      else setError(r.error?.message ?? "خطا");
                      const b = (accounts?.bank ?? []).find((x) => x.id === sel.id);
                      if (b) await openBank(b);
                    }}
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--muted)]/40"
                  >
                    تطبیق خودکار با پرداخت‌ها
                  </button>
                </div>
                {recon && (
                  <div className="flex flex-wrap gap-4 rounded-lg bg-[var(--muted)]/30 p-3 text-sm">
                    <span>مانده دفتری: <b>{fa(recon.book)}</b></span>
                    <span>جمع صورتحساب: <b>{fa(recon.statement)}</b></span>
                    <span className={recon.difference === "0" ? "text-emerald-600" : "text-red-600"}>مغایرت: <b>{fa(recon.difference)}</b></span>
                    <span className="text-[var(--muted)]">{fa(recon.statementCount)} ردیف</span>
                  </div>
                )}
                <div className="max-h-48 overflow-y-auto rounded-lg border border-[var(--border)]">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-[var(--muted)]/40">
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
                      {(stmts ?? []).length === 0 && <tr><td className="p-2 text-[var(--muted)]" colSpan={4}>ردیفی ثبت نشده.</td></tr>}
                    </tbody>
                  </table>
                </div>
                {/* فاز ۹ — Wave 3: تأیید وصول چک از صورتحساب (Match ≠ Clear) */}
                {sel && <StatementChecks bankAccountId={sel.id} />}
              </div>
            </>
          )}
        </section>
      )}

      {/* ---------------- Checks workspace (بخش ۱۱) ---------------- */}
      {tab === "checks" && <ChecksWorkspace />}
    </div>
  );
}

/** اکشن‌های سریع Overview — بخش ۱۰ */
function QuickActions({ allAccounts, onAct, loading }: {
  allAccounts: Array<{ id: string; label: string }>;
  onAct: (path: string, body: object, okMsg: string) => Promise<void>;
  loading: boolean;
}) {
  const [accountId, setAccountId] = useState(allAccounts[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  return (
    <div className="rounded-xl border border-[var(--border)] p-4">
      <h2 className="mb-2 font-bold">اکشن‌های سریع</h2>
      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label className="text-xs text-[var(--muted)]">
          حساب
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="mt-1 block w-56 rounded-lg border border-[var(--border)] bg-transparent px-2 py-2">
            <option value="">— انتخاب حساب —</option>
            {allAccounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-[var(--muted)]">
          مبلغ
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="mt-1 block w-36 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2" />
        </label>
        <label className="text-xs text-[var(--muted)]">
          شرح
          <input value={desc} onChange={(e) => setDesc(e.target.value)} className="mt-1 block w-56 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2" />
        </label>
        <button disabled={loading || !accountId || !amount} onClick={() => void onAct("/admin/treasury/cash-in", { accountId, amount: Number(amount), description: desc }, "دریافت ثبت شد")} className="rounded-lg bg-emerald-600 px-3 py-2 text-white disabled:opacity-50">ثبت دریافت</button>
        <button disabled={loading || !accountId || !amount} onClick={() => void onAct("/admin/treasury/cash-out", { accountId, amount: Number(amount), description: desc }, "پرداخت ثبت شد")} className="rounded-lg bg-red-600 px-3 py-2 text-white disabled:opacity-50">ثبت پرداخت</button>
        <button disabled={loading || !accountId || !amount} onClick={() => void onAct("/admin/treasury/transfer", { fromId: accountId, toId: window.prompt("شناسه حساب مقصد؟") ?? "", amount: Number(amount), description: desc }, "انتقال ثبت شد")} className="rounded-lg border border-[var(--border)] px-3 py-2 disabled:opacity-50">انتقال وجه</button>
        <span className="text-xs text-[var(--muted)]">ثبت چک → تب «چک‌ها»</span>
      </div>
    </div>
  );
}

/** عملیات حساب انتخاب‌شده — واریز/برداشت/انتقال (reuse از نسخهٔ قبلی) */
function AccountOps({ sel, allAccounts, amount, setAmount, desc, setDesc, transferTo, setTransferTo, loading, act }: {
  sel: { type: "cash" | "bank"; id: string; name: string };
  allAccounts: Array<{ id: string; label: string }>;
  amount: string; setAmount: (v: string) => void;
  desc: string; setDesc: (v: string) => void;
  transferTo: string; setTransferTo: (v: string) => void;
  loading: boolean;
  act: (path: string, body: object, okMsg: string) => Promise<void>;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-[var(--border)] p-4">
      <h2 className="font-bold">عملیات: {sel.name}</h2>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          مبلغ (تومان)
          <input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} className="mt-1 block w-40 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2" />
        </label>
        <label className="text-sm">
          شرح
          <input value={desc} onChange={(e) => setDesc(e.target.value)} className="mt-1 block w-64 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2" />
        </label>
        <button disabled={loading || !amount} onClick={() => void act("/admin/treasury/cash-in", { accountId: sel.id, amount: Number(amount), description: desc }, "واریز ثبت شد")} className="rounded-lg bg-emerald-600 px-3 py-2 text-sm text-white disabled:opacity-50">واریز</button>
        <button disabled={loading || !amount} onClick={() => void act("/admin/treasury/cash-out", { accountId: sel.id, amount: Number(amount), description: desc }, "برداشت ثبت شد")} className="rounded-lg bg-red-600 px-3 py-2 text-sm text-white disabled:opacity-50">برداشت</button>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-3">
        <label className="text-sm">
          انتقال به
          <select value={transferTo} onChange={(e) => setTransferTo(e.target.value)} className="mt-1 block w-64 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2">
            <option value="">— انتخاب مقصد —</option>
            {allAccounts.filter((a) => a.id !== sel.id).map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
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
    </section>
  );
}
