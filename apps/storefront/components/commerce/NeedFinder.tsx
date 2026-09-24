"use client";

/**
 * NeedFinder — ویزارد کشف محصول (بند ۹ spec).
 * گام‌ها: موقعیت → اولویت → بودجه؛ بدون دکمه Next (انتخاب = پیشروی).
 * نتیجه: محصولات منطبق + دلیل انطباق + نزدیک‌ترین‌ها + امکان تغییر پاسخ.
 * گزینه «هنوز نمی‌دونم» در صفحه خانه کل ویزارد را باز می‌کند.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { ProductCard } from "./ProductCard";
import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";
import { getTerm } from "@/lib/attributes";
import { getAllProductsV2, hasAnyStock, minPrice } from "@/lib/catalog-repo";
import { NEEDS, matchesNeed, type Need } from "@/lib/needs";
import type { CategorySlug } from "@/lib/attributes";
import type { ProductV2 } from "@/lib/catalog";

const SITUATION_ICONS: Record<string, string> = {
  everyday: "🌿",
  formal: "✨",
  sport: "🏃‍♀️",
  shaping: "💗",
  comfort: "😌",
  gift: "🎁",
};

/** گام ۱: موقعیت — از نیازهای اصلی */
const SITUATIONS: { need: Need; icon: string }[] = NEEDS.map((n) => ({
  need: n,
  icon: SITUATION_ICONS[n.slug] ?? "💜",
}));

/** گام ۲: اولویت */
interface WizardOption {
  id: string;
  label: string;
  icon?: string;
  materialIds?: string[];
  priceMax?: number;
}

const PRIORITIES: WizardOption[] = [
  { id: "comfort", label: "راحتی بیشتر", icon: "💜", materialIds: ["mt-cotton", "mt-modal"] },
  { id: "look", label: "ظاهر و فرم", icon: "✨" },
  { id: "cotton", label: "جنس نخی", icon: "🌿", materialIds: ["mt-cotton"] },
  { id: "economy", label: "اقتصادی", icon: "🪙", priceMax: 400000 },
  { id: "quality", label: "کیفیت بالاتر", icon: "⭐", priceMax: 750000 },
];

/** گام ۳: بودجه */
const BUDGETS: WizardOption[] = [
  { id: "u300", label: "تا ۳۰۰ هزار", priceMax: 300000 },
  { id: "u500", label: "تا ۵۰۰ هزار", priceMax: 500000 },
  { id: "open", label: "مهم نیست" },
];

interface Answer {
  /** ۰ = موقعیت (نیاز اصلی)، ۱ = اولویت، ۲ = بودجه */
  step: number;
  id: string;
}

export function NeedFinder({
  onClose,
  initialSituation,
}: {
  onClose?: () => void;
  /** نیاز اولیه از URL (?start=sport) — گام ۱ از قبل انتخاب می‌شود */
  initialSituation?: string;
}) {
  const [answers, setAnswers] = useState<Answer[]>(() =>
    initialSituation && NEEDS.some((n) => n.slug === initialSituation)
      ? [{ step: 0, id: initialSituation }]
      : [],
  );
  const step = answers.length;

  const pick = (id: string) => {
    setAnswers((prev) => [...prev.slice(0, step), { step, id }]);
  };
  const back = () => setAnswers((prev) => prev.slice(0, -1));
  const restart = () =>
    setAnswers(
      initialSituation && NEEDS.some((n) => n.slug === initialSituation)
        ? [{ step: 0, id: initialSituation }]
        : [],
    );

  return (
    <div className="mx-auto max-w-2xl">
      {step < 3 ? (
        <StepView stepIndex={step} answers={answers} onPick={pick} onBack={back} onClose={onClose} />
      ) : (
        <ResultView answers={answers} onRestart={restart} onClose={onClose} />
      )}
    </div>
  );
}

function StepView({
  stepIndex,
  answers,
  onPick,
  onBack,
  onClose,
}: {
  stepIndex: number;
  answers: Answer[];
  onPick: (id: string) => void;
  onBack: () => void;
  onClose?: () => void;
}) {
  const STEPS: { title: string; desc: string; options: WizardOption[] }[] = [
    {
      title: "برای چه موقعیتی می‌خوای؟",
      desc: "یک گزینه انتخاب کن تا پیشنهادها دقیق‌تر بشن.",
      options: SITUATIONS.map((s) => ({ id: s.need.slug, label: s.need.label, icon: s.icon })),
    },
    {
      title: "چه چیزی برات مهم‌تره؟",
      desc: "اولویتت رو بگو — روی پیشنهادها اثر می‌ذاره.",
      options: PRIORITIES.map((p) => ({ id: p.id, label: p.label, icon: p.icon })),
    },
    {
      title: "حدود بودجه‌ات چقدره؟",
      desc: "برای فیلتر دقیق‌تر — می‌تونی رد کنی.",
      options: BUDGETS.map((b) => ({ id: b.id, label: b.label })),
    },
  ];
  const s = STEPS[stepIndex];

  return (
    <div className="rounded-3xl border border-line bg-surface p-5 shadow-clay-1 sm:p-7">
      {/* progress */}
      <div
        className="mb-5 flex items-center gap-2"
        aria-label={`مرحله ${faNum(stepIndex + 1)} از ${faNum(3)}`}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i <= stepIndex ? "bg-primary" : "bg-primary-tint",
            )}
          />
        ))}
        <span className="ms-1 text-[11px] text-muted tnum">
          {faNum(stepIndex + 1)} از {faNum(3)}
        </span>
      </div>

      <h2 className="font-display text-2xl text-plum">{s.title}</h2>
      <p className="mt-1 text-[13px] text-muted">{s.desc}</p>

      <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {s.options.map((o) => {
          const prev = answers[stepIndex]?.id === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onPick(o.id)}
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
        {stepIndex > 0 && (
          <button
            type="button"
            onClick={onBack}
            className="rounded-full border border-line px-4 py-2 text-[13px] font-semibold text-ink hover:bg-primary-tint"
          >
            قبلی
          </button>
        )}
      </div>
    </div>
  );
}

/* ── نتیجه */

function ResultView({
  answers,
  onRestart,
  onClose,
}: {
  answers: Answer[];
  onRestart: () => void;
  onClose?: () => void;
}) {
  const all = useMemo(() => getAllProductsV2().filter(hasAnyStock), []);

  const { matches, reason } = useMemo(() => {
    const situationNeed = NEEDS.find((n) => n.slug === answers[0]?.id);
    const priority: WizardOption | undefined = PRIORITIES.find(
      (p) => p.id === answers[1]?.id,
    );
    const budget: WizardOption | undefined = BUDGETS.find(
      (b) => b.id === answers[2]?.id,
    );

    const priceMax = Math.min(
      priority?.priceMax ?? Infinity,
      budget?.priceMax ?? Infinity,
    );
    const hasPriceMax = priceMax !== Infinity;
    const materialIds = priority?.materialIds;

    const matched = all.filter((p) => {
      if (situationNeed && !matchesNeed(p, situationNeed)) return false;
      if (materialIds && !materialIds.some((m) => p.attributeIds.includes(m)))
        return false;
      if (hasPriceMax && minPrice(p) > priceMax) return false;
      return true;
    });

    const reasons: string[] = [];
    if (situationNeed) reasons.push(situationNeed.why);
    if (materialIds) reasons.push(`جنس ${materialIds.map((m) => safeTerm(m)).join(" یا ")}`);
    if (hasPriceMax) reasons.push(`بودجه تا ${faNum(priceMax)} تومان`);

    return {
      matches: matched,
      reason: reasons.length ? reasons.join(" · ") : "همه محصولات",
    };
  }, [answers, all]);

  const closeMatches = all
    .filter((p) => !matches.includes(p))
    .slice(0, 4);

  return (
    <div>
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-clay-1 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-2xl text-plum">پیشنهادهای قاصدک</h2>
          <button
            type="button"
            onClick={onRestart}
            className="rounded-full border border-line px-3.5 py-1.5 text-[12px] font-semibold text-ink hover:bg-primary-tint"
          >
            تغییر پاسخ‌ها
          </button>
        </div>
        <p className="mt-2 text-[13px] text-muted">
          بر اساس انتخاب‌هایت: <strong className="font-semibold text-ink">{reason}</strong>
        </p>

        {matches.length ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {matches.slice(0, 8).map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
            <Link
              href="/c/bra"
              className="mt-4 inline-flex h-11 items-center rounded-full border border-line bg-surface px-5 text-[13px] font-semibold text-primary-strong hover:bg-primary-tint"
            >
              مشاهده همه محصولات
            </Link>
          </>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-line p-6 text-center">
            <p className="text-sm font-semibold text-ink">با این ترکیب، محصول دقیقی نداریم</p>
            <p className="mt-1 text-[13px] text-muted">
              نزدیک‌ترین‌ها رو ببین یا پاسخ‌هات رو تغییر بده.
            </p>
          </div>
        )}
      </div>

      {/* نزدیک‌ترین‌ها اگر انطباق کم بود */}
      {matches.length < 4 && closeMatches.length > 0 && (
        <section className="mt-6" aria-label="نزدیک‌ترین پیشنهادها">
          <h3 className="mb-3 text-[15px] font-bold text-ink">نزدیک‌ترین‌ها</h3>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {closeMatches.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {onClose && (
        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-line px-5 py-2.5 text-[13px] font-semibold text-ink hover:bg-primary-tint"
          >
            بستن
          </button>
        </div>
      )}
    </div>
  );
}

function safeTerm(id: string): string {
  try {
    return getTerm(id).label;
  } catch {
    return id;
  }
}
