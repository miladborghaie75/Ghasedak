"use client";

/**
 * Interactive Size Finder — بند ۴۳ Master:
 * موبایل-فرست RTL، سه گام: زیر سینه → سینه → توصیه (با SVG زنده و کم‌هزینه).
 * خروجی = توصیه + جایگزین + اتصال مستقیم به انتخاب سایز همان صفحه (VariantMatrix).
 * هیچ ادعای قطعیتی ندارد (بند ۴۲/۴۴)؛ قابل ویرایش و بازگشت؛
 * وضعیت فوکوس/خطا/دسترس‌پذیری کامل (label + inputmode + aria-live).
 */
import { useMemo, useState } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { faNum } from "@/lib/format";
import {
  isBraLike,
  recommendBraSize,
  recommendLetterSize,
} from "@/lib/size-system";
import type { CategorySlug } from "@/lib/attributes";

interface Props {
  /** دسته محصول — نوع جریان (سوتین‌محور یا حرفی) را تعیین می‌کند */
  category: CategorySlug;
  /** قواعد فیت برند/مدل */
  productId?: string;
  brandId?: string;
  /** اتصال به انتخابگر سایز صفحه محصول */
  onApply?: (sizeTermId: string, cupTermId: string | null) => void;
  triggerLabel?: string;
}

type Step = 0 | 1 | 2;

export function SizeFinderButton({
  category,
  productId,
  brandId,
  onApply,
  triggerLabel = "سایزت رو نمی‌دونی؟",
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1.5 text-[12px] font-bold text-primary-strong transition-colors hover:bg-primary-tint"
      >
        📏 {triggerLabel}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="راهنمای انتخاب سایز">
        <SizeFinderFlow
          category={category}
          productId={productId}
          brandId={brandId}
          onApply={(s, c) => {
            setOpen(false);
            onApply?.(s, c);
          }}
        />
      </Sheet>
    </>
  );
}

export function SizeFinderFlow({
  category,
  productId,
  brandId,
  onApply,
}: Omit<Props, "triggerLabel" | "open">) {
  const bra = isBraLike(category);
  const [step, setStep] = useState<Step>(0);
  const [under, setUnder] = useState("");
  const [bust, setBust] = useState("");

  const rec = useMemo(() => {
    if (step < 2) return null;
    const u = parseFloat(under.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
    if (bra) {
      const b = parseFloat(bust.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))));
      return recommendBraSize({ underBust: u, bust: b }, { productId, brandId });
    }
    return recommendLetterSize(u);
  }, [step, under, bust, bra, productId, brandId]);

  const canNext = step === 0 ? parseFloat(under) > 0 : bra ? parseFloat(bust) > 0 : true;

  return (
    <div className="flex flex-col gap-4">
      {/* نوار پیشرفت */}
      <ol className="flex items-center gap-2" aria-label={`گام ${faNum(step + 1)} از ۳`}>
        {["زیر سینه", bra ? "دور سینه" : "تایید", "توصیه"].map((label, i) => (
          <li key={label} className="flex flex-1 flex-col gap-1">
            <span
              aria-current={step === i ? "step" : undefined}
              className={`h-1.5 rounded-full ${i <= step ? "bg-primary" : "bg-line"}`}
            />
            <span className={`text-[11px] ${i === step ? "font-bold text-primary-strong" : "text-muted"}`}>
              {label}
            </span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <MeasureStep
          title="دور زیر سینه را اندازه بگیر"
          hint="متر را صاف و بدون کشیدگی، درست زیر سینه دور تن بگیرید. نفس عادی بکشید."
          value={under}
          onChange={setUnder}
          art={<TapeArt label="زیر سینه" kind="under" />}
        />
      )}

      {step === 1 && !bra && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-7 text-muted">
            این دسته با «دور زیر سینه» سایز تقریبی پیشنهاد می‌شود. عدد را می‌توانید بعداً ویرایش کنید.
          </p>
          <button type="button" onClick={() => setStep(2)} className="h-11 rounded-full bg-primary text-sm font-bold text-on-accent">
            ادامه
          </button>
        </div>
      )}

      {step === 1 && bra && (
        <MeasureStep
          title="دور پرترین قسمت سینه"
          hint="متر را دور پرترین قسمت سینه، موازی زمین بگیرید؛ نه آن‌قدر سفت که فرورود، نه آن‌قدر شل که بغلتد."
          value={bust}
          onChange={setBust}
          art={<TapeArt label="دور سینه" kind="bust" />}
        />
      )}

      {step === 2 && rec && (
        <div className="flex flex-col gap-3" aria-live="polite">
          {rec.valid ? (
            <>
              <div className="rounded-card border border-line bg-primary-tint/60 p-4 text-center">
                <p className="text-[12px] text-muted">سایز پیشنهادی ما</p>
                <p className="mt-1 font-display text-3xl text-primary-strong tnum">
                  {bra ? `${faNum(rec.band)}/${cupFa(rec.cupTermId)}` : rec.sizeTermId.replace("sz-", "")}
                </p>
                <p className="mt-2 text-[12px] leading-6 text-muted">{rec.explanation}</p>
              </div>
              {rec.alternates.length > 0 && (
                <p className="text-[12px] leading-6 text-muted">
                  <strong className="text-ink">جایگزین‌های نزدیک:</strong>{" "}
                  {rec.alternates.join(" · ")} — اگر فیت دقیق خواستی هر دو را امتحان کن.
                </p>
              )}
              <button
                type="button"
                onClick={() => rec.valid && onApply?.(rec.sizeTermId, rec.cupTermId)}
                className="h-12 rounded-full bg-primary text-sm font-bold text-on-accent shadow-clay-1 transition-transform active:scale-[0.98]"
              >
                اعمال این سایز روی انتخاب‌ها
              </button>
            </>
          ) : (
            <p className="rounded-card border border-app-err/40 bg-primary-tint/40 p-3 text-[13px] leading-7 text-app-err">
              {rec.inputError}
            </p>
          )}
          <button type="button" onClick={() => setStep(0)} className="text-[12px] font-bold text-primary-strong underline underline-offset-4">
            ویرایش اندازه‌ها
          </button>
        </div>
      )}

      {/* ناوبری */}
      {step < 2 && (
        <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
          <button
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => (s - 1) as Step)}
            className="rounded-full border border-line px-4 py-2 text-[12px] font-bold text-ink disabled:opacity-40"
          >
            قبلی
          </button>
          <button
            type="button"
            disabled={!canNext}
            onClick={() => setStep((s) => (s + 1) as Step)}
            className="h-11 min-w-28 rounded-full bg-primary px-5 text-sm font-bold text-on-accent disabled:cursor-not-allowed disabled:bg-primary-tint disabled:text-muted"
          >
            بعدی
          </button>
        </div>
      )}
    </div>
  );
}

function MeasureStep({
  title,
  hint,
  value,
  onChange,
  art,
}: {
  title: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
  art: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        {art}
        <div>
          <h3 className="text-sm font-extrabold text-ink">{title}</h3>
          <p className="mt-1 text-[12px] leading-6 text-muted">{hint}</p>
        </div>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-bold text-ink">اندازه (سانت‌متر)</span>
        <input
          type="number"
          inputMode="numeric"
          min={58}
          max={130}
          step={0.5}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="مثلاً ۷۵"
          className="h-12 rounded-xl border border-line bg-surface px-3 text-sm font-bold text-ink outline-none focus:border-primary focus:ring-2 focus:ring-app-focus-ring"
        />
      </label>
    </div>
  );
}

/** SVG سبک — خط اندازه‌گیری؛ انیمیشن CSS ملایم (بند ۴۳: بدون Lottie سنگین) */
function TapeArt({ label, kind }: { label: string; kind: "under" | "bust" }) {
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0" aria-hidden>
      <circle cx="32" cy="32" r="22" fill="none" stroke="var(--color-line)" strokeWidth="3" />
      <circle
        cx="32" cy="32" r="22"
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="34 104"
        className="origin-center animate-[spin_5s_linear_infinite]"
        style={{ transformBox: "fill-box" }}
      />
      <text x="32" y="36" textAnchor="middle" fontSize="9" fill="var(--color-ink)" fontWeight="700">
        {kind === "under" ? "زیر" : "سینه"}
      </text>
    </svg>
  );
}

function cupFa(cupTermId: string | null): string {
  if (!cupTermId) return "";
  return cupTermId.replace("cup-", "");
}
