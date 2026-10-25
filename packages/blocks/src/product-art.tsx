import { clsx } from "clsx";
import { ART_FRAME_KINDS, type ArtFrameKind } from "@ghasedak/contracts";

/**
 * آرت محصول — تک‌منبعِ تصویرسازی برند (سبک clay، SVG).
 *
 * چرا در پکیج بلوک‌ها و نه فقط فروشگاه؟ چون کارت محصول، قاب هیرو، قاب آرت و
 * بلوک «نمونه‌کار» صفحه‌ساز همه باید یک شکل بکشند؛ بلوک‌ها هم در سایت و هم در
 * بوم ادمین رندر می‌شوند. اگر این فایل داخل فروشگاه می‌ماند، بلوک نمی‌توانست
 * از آن استفاده کند و ناچار یک نسخهٔ دوم ساخته می‌شد — دو حقیقت بصری.
 *
 * رنگ به‌صورت رشتهٔ CSS می‌آید (`#rrggbb` یا `var(--color-…)`) تا هم فروشگاه
 * رنگ واقعی ترم محصول را بدهد و هم بلوک بدون هیچ hex خام از توکن برند استفاده کند.
 */

/**
 * قانون برند: هیچ عکس مدل زن استفاده نمی‌شود (بند ۵) — آرت جای عکس است.
 *
 * فهرست فرم‌ها از قرارداد برند می‌آید (`ART_FRAME_KINDS`) تا قفسهٔ «نمونه‌کار»
 * و آرتِ کارت محصول یک حقیقت داشته باشند: هر فرمی که آرت دارد، در قفسه هم
 * هست و برعکس.
 */
export type ArtKind = ArtFrameKind;

export const ART_KINDS: ArtKind[] = ART_FRAME_KINDS.map((k) => k.value);

const ART_TITLES: Record<ArtKind, string> = {
  bra: "تصویر سوتین",
  panty: "تصویر شورت",
  set: "تصویر ست لباس زیر",
  shapewear: "تصویر گن",
  sport: "تصویر لباس ورزشی",
  sleepwear: "تصویر لباس خواب",
};

/**
 * شناسهٔ گرادیان مخصوص هر (نوع، رنگ).
 *
 * نسخهٔ قبلی برای همهٔ آرت‌های یک نوع، یک شناسهٔ ثابت می‌ساخت؛ در گریدی که دو
 * سوتین با دو رنگ داشت، هر دو گرادیانِ اولی را می‌گرفتند و رنگ دوم بی‌اثر بود.
 * با آمدن شناسهٔ وابسته به رنگ، همان نوع با رنگ‌های مختلف درست رنگ می‌شود.
 */
function gradientId(kind: ArtKind, color: string): string {
  const safe = color.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
  return `art-${kind}-${safe || "brand"}`;
}

/**
 * زبانِ ترسیم: هر فرم یک «پهن کردنِ» صاف (flat-lay) است، نه هندسهٔ انتزاعی.
 *
 * قاعده‌هایی که هر شش فرم رعایت می‌کنند تا در یک قفسه کنار هم «یک زبان» بمانند:
 *  ۱) هر فرم یک سیلوئتِ یکپارچه دارد که از دور خوانده می‌شود؛ جزئیات (درز،
 *     بند، بند شانه) اضافه‌اند و سیلوئت را نجات نمی‌دهند.
 *  ۲) نسبت‌ها واقعی‌اند: سوتین پهن و کوتاه است، ستِ لباس خواب بلند و ریزشی،
 *     گن بلند و باریک، ورزشی با کش‌دِ زیرِ پهن. همین تفاوتِ نسبت است که فرم‌ها
 *     را از هم جدا می‌کند، نه رنگ.
 *  ۳) درزها با خطِ سفیدِ کم‌رنگ کشیده می‌شوند تا روی هر رنگِ محصول بنشینند و
 *     فقط یک لایهٔ «خوانایی» باشند، نه رنگِ تازه.
 *  ۴) زیرِ هر فرم یک سایهٔ تماسِ کم‌رنگ می‌نشیند تا شکل «روی سطح» بایستد.
 */
const SEAM = {
  fill: "none",
  stroke: "#ffffff",
  strokeOpacity: 0.32,
  strokeWidth: 1.6,
  strokeLinecap: "round",
} as const;

/** جای سایهٔ تماس زیر هر فرم — ارتفاع با پایینِ واقعیِ فرم می‌خواند */
const SHADOWS: Record<ArtKind, { cy: number; rx: number }> = {
  bra: { cy: 68, rx: 26 },
  panty: { cy: 66, rx: 25 },
  set: { cy: 84, rx: 23 },
  shapewear: { cy: 92, rx: 23 },
  sport: { cy: 70, rx: 27 },
  sleepwear: { cy: 94, rx: 28 },
};

/**
 * پد آمان — نوعِ ناشناخته به فرم پیش‌فرض برمی‌گردد، نه کرش.
 *
 * چرا لازم است: `kind` در کارت محصول از اسلاگِ دسته می‌آید (`product.category`).
 * هر دسته‌ای که در شش فرم آرت نیست (دسته‌های تست، دستهٔ تازه، دادهٔ واردشده)
 * قبلاً `SHADOWS[kind]` را undefined می‌گذاشت و SSR کل صفحه را با
 * «reading 'cy'» می‌انداخت. آرتِ دکوری نباید هیچ‌وقت مسیر خرید را بشکند.
 */
const DEFAULT_ART_KIND: ArtKind = "bra";
function safeKind(kind: ArtKind): ArtKind {
  return SHADOWS[kind] ? kind : DEFAULT_ART_KIND;
}

/* ────────────────────────── شکل‌های پایه ────────────────────────── */

/**
 * سوتین — دو کاپِ نیم‌گرد با فاصلهٔ مرکزی، بندِ زیرِ کشیده و دو بندِ شانه.
 * کاپ‌ها از بیرونِ بالا (بندِ شانه) به مرکزِ پایین می‌روند؛ همین «افت» است که
 * آن را از یک مستطیلِ ساده جدا می‌کند.
 */
function BraShape({ g }: { g: string }) {
  return (
    <g>
      {/* بندهای شانه — پشتِ کاپ، از لبهٔ بالایی بیرون می‌زنند */}
      <path d="M29 31C26 24 24.5 18 24.5 12" fill="none" stroke={`url(#${g})`} strokeWidth={3.4} strokeLinecap="round" />
      <path d="M71 31C74 24 75.5 18 75.5 12" fill="none" stroke={`url(#${g})`} strokeWidth={3.4} strokeLinecap="round" />
      {/* بندِ زیر — نازک و هم‌پهنای کاپ‌ها؛ بندِ ضخیم‌تر از کاپ، فرم را «سینی» می‌کرد */}
      <path d="M22 52C35 56 65 56 78 52L78 57.5C65 61.5 35 61.5 22 57.5Z" fill={`url(#${g})`} />
      {/* کاپِ چپ و راست */}
      <path d="M27 26C33 30 40 34 47 36.5C50 37.5 50 41 50 45C50 50 47 54 42 56C36 58 28 56 25 50C22 44 22 32 27 26Z" fill={`url(#${g})`} />
      <path d="M73 26C67 30 60 34 53 36.5C50 37.5 50 41 50 45C50 50 53 54 58 56C64 58 72 56 75 50C78 44 78 32 73 26Z" fill={`url(#${g})`} />
      {/* درزِ کاپ (فنرِ زیرِ کاپ) */}
      <path d="M25 47C31 54 40 57 47 53" {...SEAM} />
      <path d="M75 47C69 54 60 57 53 53" {...SEAM} />
    </g>
  );
}

/**
 * شورت — کمرِ کش‌دارِ باریک، باسنِ باز و دو برشِ پایِ منحنی که به لبهٔ کوتاهِ
 * فاق می‌رسند.
 *
 * چرا فاق «نوک» ندارد؟ نسخهٔ قبلی در پایین به یک نقطه می‌رسید و از دور شبیه
 * برگ/سپر دیده می‌شد. شورتِ واقعی در نمای صاف، فاقِ کوتاه و گرد دارد؛ همان
 * لبهٔ ۱۴ واحدیِ پایین است که فرم را «شورت» می‌خواناند، نه «مثلث».
 */
function PantyShape({ g }: { g: string }) {
  return (
    <g>
      {/* کمرِ کش‌دار — پهن‌ترین خطِ فرم، همان‌طور که در شورتِ تخت‌خوابیده است */}
      <path d="M22 20L78 20L77 27Q50 29.5 23 27Z" fill={`url(#${g})`} />
      {/*
       * بدنه: ذوزنقه با گوشه‌های گرد — نه بالونی و نه کاسه‌ای.
       * نکتهٔ طراحی: اگر بدنه زیرِ کمر بیرون بزند و فاق به یک نقطه تمام شود، فرم
       * شبیه تنگ/کاسه دیده می‌شود. اینجا پهلوها تقریباً راست پایین می‌آیند و فاقِ
       * ۲۲ واحدیِ کم‌قوس پایین می‌نشیند؛ همان ذوزنقهٔ آرکی است که «بریف» خوانده می‌شود.
       */}
      <path
        d="M23 27L27 44C30 52 34 57 39 60L61 60C66 57 70 52 73 44L77 27Q50 29 23 27Z"
        fill={`url(#${g})`}
      />
      {/* درزِ زیرِ کش — کمر را از بدنه جدا می‌کند */}
      <path d="M23 27.5Q50 30 77 27.5" {...SEAM} strokeOpacity={0.3} />
      {/* درزِ کشِ پای — دو قوسِ باریک درونِ لبهٔ پای؛ همین دو خط، فرم را از «کاسه» به «بریف» می‌برد */}
      <path d="M28.6 44C31.6 51.5 35.5 56.5 40.5 59.4" {...SEAM} strokeOpacity={0.24} />
      <path d="M71.4 44C68.4 51.5 64.5 56.5 59.5 59.4" {...SEAM} strokeOpacity={0.24} />
      {/* درزِ فاق */}
      <path d="M50 31L50 60" {...SEAM} strokeOpacity={0.18} />
    </g>
  );
}

/**
 * گن (فرم‌دهنده) — کُرستِ بدونِ بند با یقهٔ «sweetheart»، کمرِ باریک و باسنِ باز
 * که به کششِ بالای پا می‌رسد.
 *
 * چرا بدونِ بند؟ چون چهار فرمِ دیگر (سوتین، ورزشی، خواب و شورت) یا بندِ شانه
 * دارند یا کوتاه‌اند؛ تنها فرمی که «بند ندارد و ساعت‌گلی هم ندارد» همین است
 * و همان چیزی است که آن را در یک ردیفِ شش‌تایی متمایز می‌کند.
 */
function ShapewearShape({ g }: { g: string }) {
  return (
    <g>
      <path
        d="M32 30C34 26.5 37 24.5 40 25C43 25.5 45 28 47 30C48.5 31.2 51.5 31.2 53 30C55 28 57 25.5 60 25C63 24.5 66 26.5 68 30C69.5 36 68.5 42 66 48C64 53 65.5 58 70.5 62C73 65.5 72.5 70 68 74C64 78 62 82 60 84.5Q50 87.5 40 84.5C38 82 36 78 32 74C27.5 70 27 65.5 29.5 62C34.5 58 36 53 34 48C31.5 42 30.5 36 32 30Z"
        fill={`url(#${g})`}
      />
      {/* درزهای عمودیِ فرم‌دهنده (بونینگ) */}
      <path d="M40 30C38.5 44 38.5 58 40 76" {...SEAM} strokeOpacity={0.24} />
      <path d="M60 30C61.5 44 61.5 58 60 76" {...SEAM} strokeOpacity={0.24} />
      {/* خطِ کمر و خطِ باسن — ساختارِ کُرست را می‌سازد */}
      <path d="M34.2 49C41 51.5 59 51.5 65.8 49" {...SEAM} strokeOpacity={0.26} />
      <path d="M29.8 63C38 66 62 66 70.2 63" {...SEAM} strokeOpacity={0.22} />
    </g>
  );
}

/**
 * لباس ورزشی — یک پارچهٔ پیوسته (نه دو کاپِ جدا) با یقهٔ گودِ پهن و دو بندِ
 * شانهٔ پهن و کشی. کشِ زیرِ پهن و بلند، امضای فرمِ ورزشی است.
 */
function SportShape({ g }: { g: string }) {
  return (
    <g>
      {/* بندهای پهنِ کوتاه — نه قوسِ بلند تا بالای قاب (که ورزشی را شبیه سوتین می‌کرد) */}
      <path d="M31 39C28.5 34 27.5 29 27.5 23.5" fill="none" stroke={`url(#${g})`} strokeWidth={6.5} strokeLinecap="round" />
      <path d="M69 39C71.5 34 72.5 29 72.5 23.5" fill="none" stroke={`url(#${g})`} strokeWidth={6.5} strokeLinecap="round" />
      {/* بدنهٔ یکپارچه (نه دو کاپِ جدا) با یقهٔ گردِ کم‌عمق */}
      <path
        d="M23 52C23 45 25.5 39.5 31 38.5C37 37.5 43 39 48.5 42.5C50 43.5 50 43.5 51.5 42.5C57 39 63 37.5 69 38.5C74.5 39.5 77 45 77 52Q50 56 23 52Z"
        fill={`url(#${g})`}
      />
      {/* کشِ زیرِ پهن */}
      <path d="M22 53C36 56.5 64 56.5 78 53L78 61C64 64.5 36 64.5 22 61Z" fill={`url(#${g})`} opacity={0.92} />
      {/* درزِ وسطِ یقه */}
      <path d="M50 50.5L50 53" {...SEAM} strokeOpacity={0.28} />
    </g>
  );
}

/**
 * لباس خواب — بلندترین فرم: بندِ نازکِ شانه، یقهٔ وی، و دامنِ ریزشیِ A.
 *
 * تفاوتِ کلیدی با بقیه، «دامنِ باز» است: از یقه تا لبهٔ دامن، فرم پیوسته و
 * باریک می‌ماند و بعد ناگهان به شکلِ A باز می‌شود. اگر دامن باز نشود، فرم
 * شبیه یک نیم‌تنهٔ کش‌دار خوانده می‌شود نه لباس خواب.
 */
function SleepwearShape({ g }: { g: string }) {
  return (
    <g>
      {/* بندهای نازکِ شانه */}
      <path d="M37 25C35 19 34 15 34 10" fill="none" stroke={`url(#${g})`} strokeWidth={2.4} strokeLinecap="round" />
      <path d="M63 25C65 19 66 15 66 10" fill="none" stroke={`url(#${g})`} strokeWidth={2.4} strokeLinecap="round" />
      {/* پیراهن با دامنِ A */}
      <path
        d="M36 24C40 33 45 38 50 41C55 38 60 33 64 24C66 32 67 40 64.5 48C70 62 78 76 84 88C66 93 34 93 16 88C22 76 30 62 35.5 48C33 40 34 32 36 24Z"
        fill={`url(#${g})`}
      />
      {/* درزِ زیرِ سینه */}
      <path d="M33.6 44C41 47 59 47 66.4 44" {...SEAM} strokeOpacity={0.26} />
    </g>
  );
}

/**
 * ست لباس زیر — دو تکهٔ هماهنگ (سوتین بالا، شورت پایین) با فاصلهٔ اندک.
 * همان دو شکلِ پایه بازاستفاده می‌شوند؛ فقط کوچک و جابه‌جا می‌شوند تا
 * «یک ست» خوانده شود، نه «دو فرمِ تصادفی».
 */
function SetShape({ g }: { g: string }) {
  return (
    <g>
      <g transform="translate(50 24) scale(0.5) translate(-50 -38)">
        <BraShape g={g} />
      </g>
      <g transform="translate(50 64) scale(0.56) translate(-50 -40)">
        <PantyShape g={g} />
      </g>
    </g>
  );
}

export function ArtSilhouette({
  kind,
  color = "var(--color-app-primary)",
  label,
  className,
}: {
  kind: ArtKind;
  /** رنگ CSS — hex ترم محصول یا `var(--color-…)` در بلوک‌ها */
  color?: string;
  /** متن جایگزین؛ پیش‌فرض نام نوع */
  label?: string;
  className?: string;
}) {
  const k = safeKind(kind);
  const g = gradientId(k, color);
  const shadow = SHADOWS[k];

  return (
    <svg
      viewBox="0 0 100 100"
      role="img"
      aria-label={label ?? ART_TITLES[k]}
      className={clsx("h-full w-full", className)}
    >
      <defs>
        <linearGradient id={g} gradientTransform="rotate(10)">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity="0.72" />
        </linearGradient>
      </defs>
      {/* سایهٔ تماس — فرم روی سطح بایستد، نه در هوا معلق باشد */}
      <ellipse cx="50" cy={shadow.cy} rx={shadow.rx} ry={4} fill={color} opacity="0.12" />

      {k === "bra" && <BraShape g={g} />}
      {k === "panty" && <PantyShape g={g} />}
      {k === "set" && <SetShape g={g} />}
      {k === "shapewear" && <ShapewearShape g={g} />}
      {k === "sport" && <SportShape g={g} />}
      {k === "sleepwear" && <SleepwearShape g={g} />}
    </svg>
  );
}

/**
 * نشان قاصدک بدون پلاک — با `currentColor` تا در تم روشن و شب درست بنشیند.
 * داخل قاب‌ها به‌عنوان «نشانِ برندِ محو» استفاده می‌شود، نه لوگوی مستقل.
 */
export function DandelionOutline({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={className} fill="none">
      <g stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
        <line x1="32" y1="32" x2="32" y2="15" />
        <line x1="32" y1="32" x2="18" y2="21" />
        <line x1="32" y1="32" x2="46" y2="21" />
        <line x1="32" y1="32" x2="15" y2="34" />
        <line x1="32" y1="32" x2="49" y2="34" />
        <line x1="32" y1="32" x2="21" y2="44" />
        <line x1="32" y1="32" x2="43" y2="44" />
        <path d="M32 40 C32 47 33 51 32 56" />
      </g>
      <g fill="currentColor">
        <circle cx="32" cy="13" r="3" />
        <circle cx="16" cy="19" r="3" />
        <circle cx="48" cy="19" r="3" />
        <circle cx="12" cy="35" r="3" />
        <circle cx="52" cy="35" r="3" />
        <circle cx="19" cy="46" r="3" />
        <circle cx="45" cy="46" r="3" />
      </g>
    </svg>
  );
}

/**
 * قاب آرت — همان زبان بصری قاب هیرو (MediaFrame): پاسپارتو.
 *
 * ساختار سه‌لایه: حاشیهٔ روشن (surface) = پاسپارتو، صفحهٔ `primary-tint` با خط
 * نازک، و آرت روی آن + مهرِ کوچک نشان برند در گوشه.
 *
 * قاعدهٔ نشان: نشان روی چیزی که هست می‌نشیند؛ اگر چیزی نیست خودش موضوع می‌شود.
 * اینجا آرت موضوع است، پس نشان فقط مهرِ گوشه است — وگرنه ده‌ها لوگوی مرکزیِ
 * تکراری در گرید می‌نشست. بلوک‌هایی که آرت ندارند، نشان را مرکزی می‌گذارند.
 */
export function ArtPlaque({
  kind,
  color,
  label,
  className,
  mark = true,
}: {
  kind: ArtKind;
  color?: string;
  label?: string;
  className?: string;
  /** نشان برندِ محو — برای تصویرهای بسیار کوچک (سبد) خاموش می‌شود */
  mark?: boolean;
}) {
  return (
    <span className={clsx("relative block overflow-hidden rounded-2xl bg-app-surface", className)}>
      {/* پاسپارتو + صفحهٔ رنگی آرت — حاشیه درصدی است تا در کارت و صفحهٔ محصول هم‌نسبت بماند */}
      <span aria-hidden className="absolute inset-[2.2%] rounded-xl bg-app-primary-tint ring-1 ring-app-line/70" />
      {mark && (
        <DandelionOutline className="absolute bottom-[6%] start-[6%] size-[16%] text-app-primary/15" />
      )}
      <span className="relative grid h-full w-full place-items-center p-[8%]">
        <ArtSilhouette kind={kind} color={color} label={label} />
      </span>
    </span>
  );
}
