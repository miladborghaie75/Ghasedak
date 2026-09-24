import { cn } from "@/lib/cn";
import { getTerm } from "@/lib/attributes";

/**
 * آرت محصول — SVG با سبک clay، رنگ از ترم رنگ محصول می‌آید.
 * قوانین برند: هیچ عکس مدل زن استفاده نمی‌شود (بند ۵).
 */
export type ArtKind = "bra" | "panty" | "set" | "shapewear" | "sport" | "sleepwear";

const ART_TITLES: Record<ArtKind, string> = {
  bra: "تصویر سوتین",
  panty: "تصویر شورت",
  set: "تصویر ست لباس زیر",
  shapewear: "تصویر گن",
  sport: "تصویر لباس ورزشی",
  sleepwear: "تصویر لباس خواب",
};

function ArtDefs({ hex, kind }: { hex: string; kind: ArtKind }) {
  const id = `art-${kind}`;
  return (
    <defs>
      <linearGradient id={id} gradientTransform="rotate(10)">
        <stop offset="0%" stopColor={hex} />
        <stop offset="100%" stopColor={hex} stopOpacity="0.72" />
      </linearGradient>
    </defs>
  );
}

export function ProductArt({
  kind,
  colorId,
  className,
}: {
  kind: ArtKind;
  colorId: string;
  className?: string;
}) {
  let hex = "#A67DEA";
  try {
    hex = getTerm(colorId).hex ?? hex;
  } catch {
    /* ترم ناشناخته → رنگ پیش‌فرض برند */
  }
  const title = ART_TITLES[kind];
  const g = `art-${kind}`;

  return (
    <svg
      viewBox="0 0 100 90"
      role="img"
      aria-label={title}
      className={cn("h-full w-full", className)}
    >
      <ArtDefs hex={hex} kind={kind} />
      <ellipse cx="50" cy="84" rx="28" ry="4" fill={hex} opacity="0.12" />

      {kind === "bra" && (
        <g fill={`url(#${g})`}>
          <path d="M30 58c-4-14-2-26 6-34 4-4 8-6 14-6s10 2 14 6c8 8 10 20 6 34a4 4 0 0 1-4 3H34a4 4 0 0 1-4-3z" />
          <path d="M32 60c12 7 26 7 38 0v3a4 4 0 0 1-2 3c-10 6-24 6-34 0a4 4 0 0 1-2-3z" opacity="0.55" />
          <path d="M38 25c-2-6-5-9-8-11M62 25c2-6 5-9 8-11" stroke={`url(#${g})`} strokeWidth="4" strokeLinecap="round" fill="none" />
        </g>
      )}

      {kind === "panty" && (
        <g fill={`url(#${g})`}>
          <path d="M38 32h24c0 12-3 20-8 26-2 3-4 4-6 4s-4-1-6-4c-5-6-8-14-8-26z" />
          <path d="M38 32h24" stroke={hex} strokeWidth="3" strokeLinecap="round" opacity="0.5" />
        </g>
      )}

      {kind === "set" && (
        <g fill={`url(#${g})`}>
          <path d="M31 27c-2-8-1-14 4-18 2-2 4-3 6-3s4 1 6 3c5 4 6 10 4 18z" />
          <path d="M42 46h16c0 9-2 15-6 20-1 2-2 3-3 3s-2-1-3-3c-4-5-6-11-6-20z" opacity="0.85" />
        </g>
      )}

      {kind === "shapewear" && (
        <g fill={`url(#${g})`}>
          <path d="M33 20h34c2 12 2 24 0 36a4 4 0 0 1-4 3H37a4 4 0 0 1-4-3c-2-12-2-24 0-36z" />
          <path d="M43 20v39M57 20v39" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="3" />
        </g>
      )}

      {kind === "sport" && (
        <g fill={`url(#${g})`}>
          <path d="M29 32h42v18a4 4 0 0 1-4 4H33a4 4 0 0 1-4-4z" />
          <path d="M37 32c0-7 4-11 11-11h4c7 0 11 4 11 11" stroke={`url(#${g})`} strokeWidth="4" fill="none" strokeLinecap="round" />
        </g>
      )}

      {kind === "sleepwear" && (
        <g fill={`url(#${g})`}>
          <path d="M35 26h30v38a4 4 0 0 1-4 4H39a4 4 0 0 1-4-4z" />
          <path d="M35 26c4-6 8-9 10-9h10c2 0 6 3 10 9" stroke={`url(#${g})`} strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M50 17v51" stroke="#ffffff" strokeOpacity="0.3" strokeWidth="3" />
        </g>
      )}
    </svg>
  );
}
