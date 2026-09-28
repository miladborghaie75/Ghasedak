"use client";

/**
 * فاز ۱۰ — بخش ۲/۳: Payment workflow واقعی.
 * روش‌ها: CASH/CARD/ONLINE/BANK_TRANSFER/CHECK + Split Payment.
 * Validation سمت کلاینت (UX) — اعتبارسنجی نهایی و اتمیک سمت سرور در /pos/sale موجود است.
 * CHECK: شماره/بانک/شعبه/شماره حساب/تاریخ صدور/سررسید — ثبت در همان tx فاکتور (بخش ۳).
 */

import { useMemo, useState } from "react";
import { fa } from "@/components/useAdminApi";

export interface PayLine {
  method: "CASH" | "CARD" | "ONLINE" | "BANK_TRANSFER" | "CHECK";
  amount: number;
  checkNumber?: string;
  bankName?: string;
  branch?: string;
  accountNumber?: string;
  issueDateDays?: number;
  dueDateDays?: number;
}

const METHODS: Array<{ code: PayLine["method"]; label: string }> = [
  { code: "CASH", label: "نقدی" },
  { code: "CARD", label: "کارت" },
  { code: "ONLINE", label: "آنلاین" },
  { code: "BANK_TRANSFER", label: "کارت به کارت" },
  { code: "CHECK", label: "چک" },
];

export function PaymentPanel({ total, disabled, onSubmit }: {
  total: number;
  disabled: boolean;
  onSubmit: (pays: PayLine[]) => void;
}) {
  const [pays, setPays] = useState<PayLine[]>([{ method: "CASH", amount: total }]);
  const [touched, setTouched] = useState(false);

  const allocated = useMemo(() => pays.reduce((a, p) => a + (Number(p.amount) || 0), 0), [pays]);
  const remaining = total - allocated;
  const overpay = remaining < 0;
  const underpay = remaining > 0;

  const setLine = (i: number, patch: Partial<PayLine>) =>
    setPays((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const addLine = () => setPays((ps) => [...ps, { method: "CASH", amount: Math.max(0, remaining) }]);

  const validate = (): string | null => {
    if (pays.length === 0) return "حداقل یک روش پرداخت لازم است.";
    for (const [i, p] of pays.entries()) {
      if (!Number.isFinite(p.amount) || p.amount <= 0) return `ردیف ${i + 1}: مبلغ باید مثبت باشد.`;
      if (p.method === "CHECK") {
        if (!p.checkNumber?.trim()) return `ردیف ${i + 1}: شماره چک لازم است.`;
        if (!p.bankName?.trim()) return `ردیف ${i + 1}: نام بانک چک لازم است.`;
        if (!Number.isFinite(p.dueDateDays) || (p.dueDateDays ?? 0) < 0) return `ردیف ${i + 1}: سررسید چک نامعتبر است.`;
      }
    }
    if (allocated !== total) {
      return overpay
        ? `مجموع پرداخت ${fa(allocated)} از فاکتور ${fa(total)} بیشتر است (overpayment).`
        : `مبلغ ${fa(remaining)} تومان باقی مانده (underpayment).`;
    }
    return null;
  };

  const submit = () => {
    setTouched(true);
    const err = validate();
    if (err) { setTouched(true); return; }
    onSubmit(pays);
  };

  const err = touched ? validate() : null;

  return (
    <div className="space-y-2">
      {pays.map((p, i) => (
        <div key={i} className="rounded-xl border border-line p-2">
          <div className="flex items-center gap-1.5">
            <select value={p.method} onChange={(e) => setLine(i, { method: e.target.value as PayLine["method"] })} className="h-8 flex-1 rounded-lg border border-line bg-surface px-1.5 text-xs font-bold">
              {METHODS.map((m) => <option key={m.code} value={m.code}>{m.label}</option>)}
            </select>
            <input value={p.amount || ""} onChange={(e) => setLine(i, { amount: Number(e.target.value) || 0 })} type="number" min={0} placeholder="مبلغ" className="h-8 w-28 rounded-lg border border-line px-2 text-xs tabular-nums" />
            {pays.length > 1 ? (
              <button onClick={() => setPays((ps) => ps.filter((_, idx) => idx !== i))} className="h-8 w-7 rounded-lg text-xs text-app-err">✕</button>
            ) : null}
          </div>
          {p.method === "CHECK" ? (
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <input value={p.checkNumber ?? ""} onChange={(e) => setLine(i, { checkNumber: e.target.value })} placeholder="شماره چک *" className="h-7 rounded-lg border border-line px-2 text-[11px]" />
              <input value={p.bankName ?? ""} onChange={(e) => setLine(i, { bankName: e.target.value })} placeholder="بانک *" className="h-7 rounded-lg border border-line px-2 text-[11px]" />
              <input value={p.branch ?? ""} onChange={(e) => setLine(i, { branch: e.target.value })} placeholder="شعبه" className="h-7 rounded-lg border border-line px-2 text-[11px]" />
              <input value={p.accountNumber ?? ""} onChange={(e) => setLine(i, { accountNumber: e.target.value })} placeholder="شماره حساب" dir="ltr" className="h-7 rounded-lg border border-line px-2 text-[11px]" />
              <input value={p.issueDateDays ?? 0} onChange={(e) => setLine(i, { issueDateDays: Number(e.target.value) || 0 })} type="number" min={0} placeholder="روز تا صدور" className="h-7 rounded-lg border border-line px-2 text-[11px] tabular-nums" />
              <input value={p.dueDateDays ?? 0} onChange={(e) => setLine(i, { dueDateDays: Number(e.target.value) || 0 })} type="number" min={0} placeholder="روز تا سررسید *" className="h-7 rounded-lg border border-line px-2 text-[11px] tabular-nums" />
            </div>
          ) : null}
        </div>
      ))}

      <div className="flex items-center justify-between text-xs">
        <button onClick={addLine} className="font-bold text-primary-strong underline">+ پرداخت ترکیبی (Split)</button>
        <span className={`tabular-nums font-bold ${overpay ? "text-app-err" : underpay ? "text-app-warning" : "text-app-ok"}`}>
          باقی‌مانده: {fa(remaining)}
        </span>
      </div>

      {err ? <p className="rounded-lg bg-app-primary-soft px-2 py-1.5 text-[11px] font-bold text-app-err">{err}</p> : null}

      <button onClick={submit} disabled={disabled}
        className="h-12 w-full rounded-xl bg-primary text-sm font-black text-on-accent disabled:opacity-50">
        ثبت فاکتور — {fa(total)}
      </button>
    </div>
  );
}
