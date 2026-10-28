"use client";

import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf";

/**
 * فرم ثبت نظر مهمان (گام ۱۱ — بند ۴۱):
 * موبایل → کد تأیید (SMS واقعی) → توکن یک‌بارمصرف → ثبت نظر (PENDING).
 * همهٔ پیام‌ها لحن فروشگاه را دارند (بند ۸۵)؛ بدون اغراق تبلیغاتی.
 */

interface ApiFail {
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
}

async function post(action: string, payload: Record<string, unknown>) {
  const res = await fetch("/api/reviews", {
    method: "POST",
    // هدر CSRF (double-submit) — مسیر /api/reviews بدون آن رد می‌کند
    headers: { "content-type": "application/json", ...csrfHeaders() },
    body: JSON.stringify({ action, payload }),
  });
  const body = (await res.json().catch(() => null)) as
    | { ok?: boolean; otpToken?: string; code?: string; message?: string; fieldErrors?: Record<string, string[]> }
    | null;
  return { ok: res.ok && body?.ok !== false, body };
}

export function ReviewForm({ slug }: { slug: string }) {
  const [rating, setRating] = useState(0);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [body, setBody] = useState("");
  const [code, setCode] = useState("");
  const [otpToken, setOtpToken] = useState<string | null>(null);
  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  function fail(b: ApiFail | null, fallback: string) {
    setErrors(b?.fieldErrors ?? {});
    setMsg(b?.message ?? fallback);
  }

  async function requestCode() {
    if (rating < 1) {
      setMsg("اول امتیاز بده: چند ستاره؟");
      return;
    }
    if (body.trim().length < 10) {
      setErrors({ body: ["متن نظر حداقل ۱۰ حرف باشد."] });
      return;
    }
    setBusy(true);
    setMsg(null);
    setErrors({});
    const { ok, body: b } = await post("otp-request", { mobile });
    setBusy(false);
    if (!ok) {
      fail(b as ApiFail, "ارسال کد ناموفق بود؛ دوباره تلاش کن.");
      return;
    }
    setStep("code");
    setMsg("کد تأیید پیامک شد؛ همین‌جا واردش کن.");
  }

  async function verifyAndSubmit() {
    setBusy(true);
    setMsg(null);
    const v = await post("otp-verify", { mobile, code });
    if (!v.ok || !v.body?.otpToken) {
      setBusy(false);
      fail(v.body as ApiFail, "تأیید کد ناموفق بود؛ دوباره تلاش کن.");
      return;
    }
    const s = await post("submit", { slug, rating, body: body.trim(), name: name.trim(), mobile, otpToken: v.body.otpToken });
    setBusy(false);
    if (!s.ok) {
      fail(s.body as ApiFail, "ثبت نظر ناموفق بود؛ دوباره تلاش کن.");
      return;
    }
    setStep("done");
    setErrors({});
  }

  if (step === "done") {
    return (
      <p className="rounded-card border border-primary-soft bg-primary-tint/60 px-4 py-3 text-[13px] leading-7 text-ink">
        ممنون! نظرت ثبت شد و بعد از بازبینی تیم قاصدک منتشر می‌شود.
      </p>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-clay-1">
      <h3 className="text-sm font-extrabold text-ink">تجربه‌ات را بنویس</h3>
      <p className="mt-1 text-[12px] leading-6 text-muted">
        نظرها بعد از بازبینی منتشر می‌شوند؛ شمارهٔ موبایل فقط برای تأیید هویت است و هرگز نمایش داده نمی‌شود.
      </p>

      {/* ستاره‌ها */}
      <div className="mt-3 flex items-center gap-1" role="radiogroup" aria-label="امتیاز از ۵">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={rating === s}
            aria-label={`${s} ستاره`}
            onClick={() => setRating(s)}
            // حداقل ۲۴×۲۴px (WCAG 2.5.8 — خطای target-size در گام ۱۹)
            className={`inline-flex min-h-6 min-w-6 items-center justify-center text-xl leading-none transition ${s <= rating ? "text-amber-500" : "text-line hover:text-amber-300"}`}
          >
            ★
          </button>
        ))}
      </div>

      {step === "form" ? (
        <>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={1500}
            placeholder="کیفیت دوخت، فرم، اندازهٔ واقعی… چی که برای بقیه مفید است؟"
            className="mt-3 w-full rounded-card border border-line bg-surface px-3 py-2 text-[13px] leading-7 text-ink outline-none focus:border-primary-strong"
          />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="نام (اختیاری)"
            className="mt-2 w-full rounded-card border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary-strong"
          />
          <input
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            inputMode="tel"
            dir="ltr"
            placeholder="موبایل — مثل ۰۹۱۲۳۴۵۶۷۸۹"
            className="mt-2 w-full rounded-card border border-line bg-surface px-3 py-2 text-[13px] text-ink outline-none focus:border-primary-strong"
          />
          <button
            type="button"
            onClick={() => void requestCode()}
            disabled={busy}
            className="mt-3 rounded-full bg-primary-strong px-5 py-2 text-[13px] font-bold text-surface disabled:opacity-50"
          >
            {busy ? "در حال ارسال…" : "دریافت کد تأیید"}
          </button>
        </>
      ) : (
        <>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            maxLength={6}
            placeholder="کد ۶ رقمی پیامک‌شده"
            className="mt-3 w-full rounded-card border border-line bg-surface px-3 py-2 text-center text-lg tracking-[0.4em] text-ink outline-none focus:border-primary-strong"
          />
          <button
            type="button"
            onClick={() => void verifyAndSubmit()}
            disabled={busy || code.length < 6}
            className="mt-3 rounded-full bg-primary-strong px-5 py-2 text-[13px] font-bold text-surface disabled:opacity-50"
          >
            {busy ? "در حال ثبت…" : "ثبت نظر"}
          </button>
          <button
            type="button"
            onClick={() => void requestCode()}
            disabled={busy}
            className="mt-2 block text-[11px] text-muted underline disabled:opacity-50"
          >
            کد جدید بفرست
          </button>
        </>
      )}

      {msg ? <p className="mt-2 text-[12px] font-bold text-primary-strong" role="status">{msg}</p> : null}
      {Object.entries(errors).map(([f, list]) =>
        list.map((e) => (
          <p key={`${f}-${e}`} className="mt-1 text-[12px] text-primary-strong">
            {e}
          </p>
        )),
      )}
    </div>
  );
}
