"use client";

import { useRef, useState } from "react";
import { COPY } from "@/lib/copy";
import { csrfHeaders as csrfHeader } from "@/lib/csrf";

function fa(n: string | number): string {
  return Number(n).toLocaleString("fa-IR");
}

interface C2cAccount {
  id: string;
  bankName: string;
  displayTitle: string | null;
  holderName: string | null;
  cardNumber: string | null;
  iban: string | null;
  customerInstructions: string | null;
}

interface SubmissionView {
  state: string;
  referenceNo: string | null;
  decisionNote: string | null;
}

const STATE_FA: Record<string, string> = {
  PENDING_VERIFICATION: "در انتظار بررسی",
  UNDER_REVIEW: "در حال بررسی",
  APPROVED: "تایید شد",
  REJECTED: "رد شد",
  CORRECTION_REQUIRED: "نیاز به اصلاح",
  EXPIRED: "منقضی شد",
  CANCELLED: "لغو شد",
};

function stateFa(state: string): string {
  return STATE_FA[state] ?? state;
}

/** دکمهٔ کپی — شماره کارت/شبا باید بدون بازکردن چیز دیگری قابل برداشتن باشد */
function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          .writeText(value)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 2000);
          })
          .catch(() => undefined);
      }}
      className="shrink-0 rounded-full border border-line px-3 py-1 text-[11px] font-bold text-ink/70 transition-colors hover:text-ink"
    >
      {done ? "کپی شد ✓" : "کپی"}
    </button>
  );
}

/**
 * فرم پرداخت — گام ۱۸-۱: دو تب، آنلاین و کارت‌به‌کارت.
 * سوییچ کارت‌به‌کارت سمت سرور است؛ خاموش یعنی این تب اصلاً رندر نمی‌شود.
 */
export function PayForm({
  code,
  total,
  c2c,
  initialSubmission,
}: {
  code: string;
  total: number;
  c2c: { enabled: boolean; expiryHours: number; accounts: C2cAccount[] };
  initialSubmission: SubmissionView | null;
}) {
  const [mode, setMode] = useState<"online" | "c2c">("online");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // کلید پایدار برای این سفارش — کلیک دوباره همان کلید را می‌فرستد (ضد تلاش تکراری)
  const idemRef = useRef<string | null>(null);

  const [submission, setSubmission] = useState<SubmissionView | null>(initialSubmission);
  const [ref, setRef] = useState(
    initialSubmission?.state === "CORRECTION_REQUIRED" ? (initialSubmission.referenceNo ?? "") : "",
  );
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [bank, setBank] = useState("");
  const [note, setNote] = useState("");

  const start = async () => {
    setBusy(true);
    setError(null);
    if (!idemRef.current) idemRef.current = `pay-${code}-${Date.now()}`;
    const idem = idemRef.current;
    try {
      const res = await fetch("/api/pay/start", {
        method: "POST",
        headers: { "content-type": "application/json", "x-idempotency-key": idem, ...csrfHeader() },
        body: JSON.stringify({ orderCode: code, idempotencyKey: idem }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; redirectUrl?: string; error?: { message?: string } }
        | null;
      if (!res.ok || !body?.ok || !body.redirectUrl) {
        setError(body?.error?.message ?? "شروع پرداخت ناموفق بود؛ دوباره تلاش کن.");
        setBusy(false);
        return;
      }
      window.location.href = body.redirectUrl;
    } catch {
      setError(COPY.networkError);
      setBusy(false);
    }
  };

  const submitReceipt = async () => {
    setBusy(true);
    setError(null);
    const idem = `c2c-${code}-${Date.now()}`;
    try {
      const res = await fetch("/api/pay/c2c", {
        method: "POST",
        headers: { "content-type": "application/json", ...csrfHeader() },
        body: JSON.stringify({
          orderCode: code,
          idempotencyKey: idem,
          referenceNo: ref,
          transferDate: date || undefined,
          transferTime: time || undefined,
          sourceBank: bank || undefined,
          note: note || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; state?: string; error?: { code?: string; message?: string } }
        | null;
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? "ثبت رسید ناموفق بود؛ دوباره تلاش کن.");
        setBusy(false);
        return;
      }
      setSubmission({
        state: body.state ?? "PENDING_VERIFICATION",
        referenceNo: ref,
        decisionNote: null,
      });
      setBusy(false);
    } catch {
      setError(COPY.networkError);
      setBusy(false);
    }
  };

  const needsForm =
    !submission ||
    ["REJECTED", "CORRECTION_REQUIRED", "EXPIRED", "CANCELLED"].includes(submission.state);

  return (
    <div className="mt-5">
      {c2c.enabled ? (
        <div className="mb-4 grid grid-cols-2 gap-2 rounded-full border border-line p-1 text-sm font-bold">
          <button
            type="button"
            onClick={() => setMode("online")}
            className={`h-10 rounded-full transition-colors ${
              mode === "online" ? "bg-primary text-on-accent" : "text-ink/60 hover:text-ink"
            }`}
          >
            پرداخت آنلاین
          </button>
          <button
            type="button"
            onClick={() => setMode("c2c")}
            className={`h-10 rounded-full transition-colors ${
              mode === "c2c" ? "bg-primary text-on-accent" : "text-ink/60 hover:text-ink"
            }`}
          >
            کارت‌به‌کارت
          </button>
        </div>
      ) : null}

      {mode === "online" ? (
        <>
          <button
            type="button"
            onClick={start}
            disabled={busy}
            className="h-12 w-full rounded-full bg-primary text-sm font-black text-on-accent disabled:opacity-60"
          >
            {busy ? "در حال انتقال به درگاه…" : `پرداخت ${fa(total)} تومان`}
          </button>
          <p className="mt-3 text-[11px] leading-5 text-ink/50">
            با انتخاب روش پرداخت آنلاین به درگاه امن بانکی هدایت می‌شوی؛ مبلغ فقط پس از تأیید سمت سرور نهایی می‌شود.
          </p>
        </>
      ) : (
        <div className="space-y-4">
          {/* کارت‌های فروشگاه */}
          <div className="space-y-3">
            {c2c.accounts.map((a) => (
              <div key={a.id} className="rounded-card border border-line bg-surface/60 p-4">
                <p className="text-sm font-black text-ink">{a.displayTitle || a.bankName}</p>
                {a.cardNumber ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span dir="ltr" className="tabular-nums text-sm text-ink/90">
                      {a.cardNumber}
                    </span>
                    <CopyButton value={a.cardNumber} />
                  </div>
                ) : null}
                {a.holderName ? (
                  <p className="mt-1 text-xs text-ink/70">به نام {a.holderName}</p>
                ) : null}
                {a.iban ? (
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span dir="ltr" className="text-[11px] tabular-nums text-ink/70">
                      شبا: {a.iban}
                    </span>
                    <CopyButton value={a.iban} />
                  </div>
                ) : null}
                {a.customerInstructions ? (
                  <p className="mt-2 text-[11px] leading-5 text-ink/60">{a.customerInstructions}</p>
                ) : null}
              </div>
            ))}
          </div>

          {/* وضعیت آخرین رسید */}
          {submission ? (
            <div className="rounded-card border border-line p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink">رسید ثبت‌شدهٔ تو</span>
                <span
                  className={
                    submission.state === "APPROVED"
                      ? "font-bold text-app-success"
                      : ["REJECTED", "EXPIRED", "CANCELLED"].includes(submission.state)
                        ? "font-bold text-app-error"
                        : "font-bold text-ink/60"
                  }
                >
                  {stateFa(submission.state)}
                </span>
              </div>
              {submission.referenceNo ? (
                <p className="mt-1 text-xs text-ink/70">کد پیگیری: {submission.referenceNo}</p>
              ) : null}
              {submission.decisionNote ? (
                <p className="mt-2 text-xs leading-5 text-app-error">{submission.decisionNote}</p>
              ) : null}
              {["PENDING_VERIFICATION", "UNDER_REVIEW"].includes(submission.state) ? (
                <p className="mt-2 text-xs leading-5 text-ink/60">
                  رسید تو نزد پشتیبانی است؛ نتیجه همین‌جا و با پیامک اعلام می‌شود. این صفحه را باز نگه دار تا نتیجه را ببینی.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-[11px] leading-5 text-ink/60">
              مبلغ {fa(total)} تومان را به یکی از کارت‌های بالا واریز کن و بعد مشخصات واریزی را در فرم زیر ثبت کن.
              مهلت واریز {fa(c2c.expiryHours)} ساعت از ثبت سفارش است.
            </p>
          )}

          {/* فرم ثبت/اصلاح رسید */}
          {needsForm ? (
            <div className="space-y-3 rounded-card border border-line p-4">
              {submission?.state === "CORRECTION_REQUIRED" ? (
                <p className="text-xs font-bold text-app-error">
                  پشتیبانی رسید قبلی را نیاز به اصلاح دانسته — مشخصات درست را دوباره ثبت کن.
                </p>
              ) : null}
              {submission?.state === "REJECTED" ? (
                <p className="text-xs font-bold text-app-error">
                  رسید قبلی رد شد؛ اگر واریز دیگری انجام داده‌ای مشخصاتش را ثبت کن.
                </p>
              ) : null}
              <label className="block text-xs font-bold text-ink/80">
                کد پیگیری واریز <span className="text-app-error">*</span>
                <input
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                  inputMode="numeric"
                  dir="ltr"
                  placeholder="مثلاً 123456789"
                  className="mt-1 h-11 w-full rounded-2xl border border-line bg-surface px-4 text-sm tabular-nums text-ink outline-none focus:border-primary"
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold text-ink/80">
                  تاریخ واریز
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 h-11 w-full rounded-2xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-primary"
                  />
                </label>
                <label className="block text-xs font-bold text-ink/80">
                  ساعت واریز
                  <input
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="mt-1 h-11 w-full rounded-2xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-primary"
                  />
                </label>
              </div>
              <label className="block text-xs font-bold text-ink/80">
                بانک مبدأ (اختیاری)
                <input
                  value={bank}
                  onChange={(e) => setBank(e.target.value)}
                  placeholder="مثلاً ملت"
                  className="mt-1 h-11 w-full rounded-2xl border border-line bg-surface px-4 text-sm text-ink outline-none focus:border-primary"
                />
              </label>
              <label className="block text-xs font-bold text-ink/80">
                توضیح برای پشتیبانی (اختیاری)
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-2xl border border-line bg-surface px-4 py-2 text-sm text-ink outline-none focus:border-primary"
                />
              </label>
              <button
                type="button"
                onClick={submitReceipt}
                disabled={busy || ref.trim().length < 5}
                className="h-12 w-full rounded-full bg-primary text-sm font-black text-on-accent disabled:opacity-60"
              >
                {busy ? "در حال ثبت…" : "ثبت رسید واریز"}
              </button>
              <p className="text-[11px] leading-5 text-ink/50">
                ثبت رسید خودکار پرداخت نمی‌کند؛ سفارش فقط بعد از تأیید پشتیبانی نهایی می‌شود.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {error ? <p className="mt-2 text-xs text-app-error">{error}</p> : null}
    </div>
  );
}
