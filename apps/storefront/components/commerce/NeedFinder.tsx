"use client";

/**
 * NeedFinder — ویزارد کشف محصول (بند ۹ spec، گام ۱۶).
 * گام‌ها/گزینه‌ها از API می‌آیند (prop از RSC) — دیگر در کامپوننت هاردکد نیستند.
 * بدون دکمه Next: هر انتخاب = پیشروی. پس از آخرین گام به `/need/result` می‌رود
 * تا نتیجه URL اشتراک‌پذیر داشته باشد؛ متن دلیل و نزدیک‌ترین‌ها آنجاست.
 * `?start=sport` → گام ۱ از قبل انتخاب می‌شود (لینک‌های NeedNav/هیرو).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NeedFinderStepDTO } from "@ghasedak/contracts";
import { buildNeedResultHref } from "@/lib/needs";
import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";

export function NeedFinder({
  steps,
  onClose,
  initialSituation,
}: {
  /** گام‌های فعال — از loadNeedFinder() در سرور */
  steps: NeedFinderStepDTO[];
  onClose?: () => void;
  /** نیاز اولیه از URL (?start=sport) — id گزینهٔ گام ۱ */
  initialSituation?: string;
}) {
  const router = useRouter();
  const validStart =
    initialSituation && steps[0]?.options.some((o) => o.id === initialSituation)
      ? initialSituation
      : undefined;

  const [answers, setAnswers] = useState<string[]>(() =>
    validStart ? [validStart] : [],
  );
  const step = answers.length;
  const total = steps.length;

  const pick = (id: string) => {
    const next = [...answers.slice(0, step), id];
    if (next.length >= total) {
      // نتیجه صفحهٔ سرور است — URL اشتراک‌پذیر + متن دلیل + نزدیک‌ترین‌ها
      router.push(buildNeedResultHref(next));
      return;
    }
    setAnswers(next);
  };
  const back = () => setAnswers((prev) => prev.slice(0, -1));

  if (!total) return null;
  if (step >= total) return null; // در حال ناوبری به نتیجه

  const s = steps[step];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-clay-1 sm:p-7">
        {/* progress */}
        <div
          className="mb-5 flex items-center gap-2"
          aria-label={`مرحله ${faNum(step + 1)} از ${faNum(total)}`}
        >
          {steps.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i <= step ? "bg-primary" : "bg-primary-tint",
              )}
            />
          ))}
          <span className="ms-1 text-[11px] text-muted tnum">
            {faNum(step + 1)} از {faNum(total)}
          </span>
        </div>

        <h2 className="font-display text-2xl text-plum">{s.question}</h2>
        <p className="mt-1 text-[13px] text-muted">
          یک گزینه انتخاب کن تا پیشنهادها دقیق‌تر شوند.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {s.options.map((o) => {
            const prev = answers[step] === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => pick(o.id)}
                aria-pressed={prev}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl border p-3 text-center transition-all active:scale-[0.98]",
                  prev
                    ? "border-primary-strong bg-primary-light"
                    : "border-line bg-surface hover:border-primary hover:bg-primary-tint",
                )}
              >
                {o.icon && (
                  <span aria-hidden className="text-xl">
                    {o.icon}
                  </span>
                )}
                <span className="text-[13px] font-semibold text-ink">{o.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              className="rounded-full px-4 py-2 text-[13px] font-semibold text-muted hover:text-ink"
            >
              بستن
            </button>
          ) : (
            <span />
          )}
          {step > 0 && (
            <button
              type="button"
              onClick={back}
              className="rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-ink hover:bg-primary-tint"
            >
              قبلی
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
