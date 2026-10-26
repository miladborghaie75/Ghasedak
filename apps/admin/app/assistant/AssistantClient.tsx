"use client";

import { useEffect, useState } from "react";
import { fa, useAdminApi } from "@/components/useAdminApi";

type Answer = {
  answer: string;
  sources: Array<{ label: string; href: string; dataAsOf: string; summary: string }>;
};

type Usage = {
  capToman: number;
  spentToman: number;
  remainingToman: number;
  reservedRequests: number;
  rows: Array<{ capability: string; requests: number; costToman: number }>;
};

const CAPABILITY_LABELS: Record<string, string> = {
  admin_assistant: "دستیار مدیریت",
  customer_chat: "چت مشتری",
};

const PROMPTS = [
  "این ماه فروش، بهای تمام‌شده و سود خالص چقدر بوده؟",
  "چه مقدار از دریافتنی‌ها سررسید گذشته است؟",
  "وضعیت مغایرت حساب‌های بانکی چیست؟",
  "کدام چک‌ها سررسید گذشته یا نزدیک دارند؟",
];

export default function AssistantClient() {
  const { call, loading } = useAdminApi();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [usageError, setUsageError] = useState(false);

  // تصویر مصرف امروز — خطا نباید به‌صورت «۰ تومان» نمایش داده شود؛ برای همین جدا از صفر است.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await call<Usage>("/admin/assistant/usage");
        if (!alive) return;
        if (result.ok && result.data) setUsage(result.data);
        else setUsageError(true);
      } catch {
        if (alive) setUsageError(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ask = async (value = question) => {
    const text = value.trim();
    if (!text || loading) return;
    setQuestion(text);
    setError("");
    setAnswer(null);
    try {
      const result = await call<Answer>("/admin/assistant/query", {
        method: "POST",
        body: JSON.stringify({ question: text }),
      });
      if (!result.ok || !result.data) {
        setError(result.error?.message ?? "پاسخ‌گویی انجام نشد؛ دوباره تلاش کن.");
        return;
      }
      setAnswer(result.data);
    } catch {
      setError("اتصال به سرویس برقرار نشد؛ وضعیت شبکه را بررسی کن و دوباره تلاش کن.");
    }
  };

  return (
    <section className="max-w-4xl space-y-4">
      <div className="rounded-card border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-black text-ink">از گزارش‌های فروشگاه بپرس</h2>
        <p className="mt-1 text-xs leading-6 text-muted">
          دستیار فقط گزارش‌های حسابداری را می‌خواند. برای سند، ثبت، حذف یا تغییر داده باید از بخش مربوطه و با تأیید خودت اقدام کنی.
        </p>
        <div className="mt-4 flex flex-wrap gap-2" aria-label="پرسش‌های پیشنهادی">
          {PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => void ask(prompt)}
              disabled={loading}
              className="rounded-full border border-line px-3 py-2 text-start text-xs text-ink hover:bg-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
            >
              {prompt}
            </button>
          ))}
        </div>
        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            void ask();
          }}
        >
          <label className="sr-only" htmlFor="admin-assistant-question">پرسش</label>
          <input
            id="admin-assistant-question"
            value={question}
            maxLength={500}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="مثلاً سود خالص این ماه چقدر است؟"
            className="min-w-0 flex-1 rounded-xl border border-line bg-bg px-4 py-3 text-sm text-ink outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/30"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="rounded-xl bg-primary px-5 py-3 text-sm font-bold text-on-accent disabled:opacity-50"
          >
            {loading ? "در حال خواندن گزارش‌ها…" : "پرسیدن"}
          </button>
        </form>
      </div>

      {usageError ? (
        <p role="status" className="rounded-card border border-line bg-surface p-4 text-xs leading-6 text-muted">
          تصویر مصرف امروز در دسترس نیست؛ کمی بعد صفحه را تازه کن تا سقف و مصرف نمایش داده شود.
        </p>
      ) : usage ? (
        <section aria-label="مصرف امروز" className="rounded-card border border-line bg-surface p-4 sm:p-6">
          <h2 className="text-xs font-black text-ink">مصرف امروزِ هوش مصنوعی (سقف مشترک چت و دستیار)</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] text-muted">سقف روزانه</dt>
              <dd className="text-sm font-bold text-ink">{fa(usage.capToman)} تومان</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">مصرف ثبت‌شده</dt>
              <dd className="text-sm font-bold text-ink">{fa(usage.spentToman)} تومان</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">باقی‌مانده</dt>
              <dd className="text-sm font-bold text-ink">{fa(usage.remainingToman)} تومان</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">رزروهای در جریان</dt>
              <dd className="text-sm font-bold text-ink">{fa(usage.reservedRequests)} درخواست</dd>
            </div>
          </dl>
          {usage.rows.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-line pt-3">
              {usage.rows.map((row) => (
                <li key={row.capability} className="flex items-center justify-between text-xs text-muted">
                  <span>{CAPABILITY_LABELS[row.capability] ?? row.capability}</span>
                  <span>{fa(row.requests)} درخواست · {fa(row.costToman)} تومان</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 border-t border-line pt-3 text-[11px] text-muted">
              امروز هنوز درخواستی ثبت نشده است؛ بعد از اولین پرسش، مصرف همین‌جا نمایش داده می‌شود.
            </p>
          )}
        </section>
      ) : null}

      {error ? <p role="alert" className="rounded-xl border border-app-err/30 bg-app-err/5 p-4 text-sm text-app-err">{error}</p> : null}

      {answer ? (
        <article className="rounded-card border border-line bg-surface p-4 sm:p-6" aria-live="polite">
          <h2 className="text-xs font-bold text-muted">پاسخ بر پایهٔ دادهٔ سامانه</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-ink">{answer.answer}</p>
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-xs font-black text-ink">منابع و بازهٔ داده</h3>
            <ul className="mt-2 space-y-2">
              {answer.sources.map((source) => (
                <li key={`${source.href}-${source.dataAsOf}`} className="rounded-xl bg-bg p-3 text-xs leading-6">
                  <a className="font-bold text-primary underline" href={source.href}>{source.label}</a>
                  <p className="text-muted">{source.summary}</p>
                  <p className="text-muted">بازه/تاریخ داده: {new Date(source.dataAsOf).toLocaleString("fa-IR")}</p>
                </li>
              ))}
            </ul>
          </div>
        </article>
      ) : null}

      <p className="text-[11px] leading-6 text-muted">
        ارقام مالی به تومان نمایش داده می‌شوند. پاسخ را با گزارش منبع بررسی کن؛ این دستیار جایگزین تأیید حسابدار نیست.
      </p>
    </section>
  );
}
