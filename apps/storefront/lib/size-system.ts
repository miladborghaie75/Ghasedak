/**
 * Size System — بند ۴۲/۴۳ Master:
 * جریان صحیح: اندازه‌های کاربر → سایز پایه (سایزچارت) → قواعد برند/مدل → توصیه.
 * هیچ سایز محاسبه‌شده‌ای «حقیقت مطلق» نیست — خروجی همیشه «توصیه» با توضیح است (بند ۴۲/۴۴).
 * منبع داده: همان اتریبیوت‌های lib/attributes (sz-70..95 / cup-A..D) — سیستم موازی ممنوع.
 */

import type { CategorySlug } from "./attributes";

/** ورودی کاربر — فقط دور زیر سینه و دور سینه (بند ۴۳) */
export interface BraMeasurements {
  /** دور زیر سینه (سانت‌متر، صاف بدون کشیدگی) */
  underBust: number;
  /** دور پرترین قسمت سینه (سانت‌متر) */
  bust: number;
}

/** توصیه نهایی — هرگز قطعی نیست؛ همیشه جایگزین‌های نزدیک دارد */
export interface SizeRecommendation {
  /** سایز فنر توصیه‌شده (70..95) */
  band: number;
  /** شناسه ترم سایز در attributes (sz-70 …) برای اتصال به VariantMatrix */
  sizeTermId: string;
  /** کاپ توصیه‌شده (A..D) یا null اگر دسته کاپ ندارد */
  cupTermId: string | null;
  /** توضیح فارسیِ کوتاه مبنای توصیه */
  explanation: string;
  /** جایگزین‌های نزدیک (وقتی بین دو سایز است یا همان مدل فیت متفاوت دارد) */
  alternates: string[];
  /** اعتبار سنجی ورودی */
  valid: boolean;
  inputError?: string;
}

/** سایزچارت پایه — فنر از دور زیر سینه (مطابق جدول SizeGuide موجود) */
export const BAND_CHART: Array<{ min: number; max: number; band: number }> = [
  { min: 63, max: 67, band: 65 },
  { min: 68, max: 72, band: 70 },
  { min: 73, max: 77, band: 75 },
  { min: 78, max: 82, band: 80 },
  { min: 83, max: 87, band: 85 },
  { min: 88, max: 92, band: 90 },
  { min: 93, max: 97, band: 95 },
];

/** کاپ = تفاضل دور سینه و دور زیر سینه (جدول استاندارد) */
export const CUP_CHART: Array<{ diff: number; cup: "A" | "B" | "C" | "D" }> = [
  { diff: 10, cup: "A" },
  { diff: 12, cup: "B" },
  { diff: 14, cup: "C" },
  { diff: 16, cup: "D" },
];

const cupTermIdOf = (cup: string) => `cup-${cup}`;

/**
 * قواعد برند/مدل — بند ۴۲: brand-specific / product-specific sizing.
 * هر قاعده: هم‌پوشانی سایزهای مدل + جهت اصلاح (sister size) + توضیح.
 * مدل‌های فعلی بر اساس فیت واقعی‌شان: نخ کش‌دار کمی گشادتر، تور/ساتن دقیق‌تر.
 */
export interface FitRule {
  /** شناسه محصول (ProductV2.id) یا برند (brandId) — اولویت: محصول > برند */
  productId?: string;
  brandId?: string;
  /** جهت اصلاح فنر: «down» = این مدل ریز است → یک فنر پایین‌تر پیشنهاد بده */
  bandShift?: "up" | "down";
  /** جهت اصلاح کاپ */
  cupShift?: "up" | "down";
  /** توضیح نمایشی */
  note: string;
}

export const FIT_RULES: FitRule[] = [
  {
    brandId: "br-paniz",
    bandShift: "up",
    note: "برند پانیذ فیت آزادتر دارد؛ اگر بین دو سایز هستی، فنر درشت‌تر راحت‌تر می‌افتد.",
  },
  {
    brandId: "br-limon",
    bandShift: "down",
    note: "برند لیمون فیت کشیده و دقیق دارد؛ اگر بین دو سایز هستی، فنر کوچک‌تر بهتر بنشیند.",
  },
  {
    productId: "gp2",
    cupShift: "down",
    note: "سوتین فنردار لعیا کاپ عمیق دارد؛ برای پرشدگی بهتر کاپ کوچک‌تر را هم امتحان کن.",
  },
];

/** محاسبه توصیه — خالص و تست‌پذیر، بدون DOM */
export function recommendBraSize(
  m: BraMeasurements,
  opts: { productId?: string; brandId?: string } = {},
): SizeRecommendation {
  const valid =
    Number.isFinite(m.underBust) &&
    Number.isFinite(m.bust) &&
    m.underBust >= 58 && m.underBust <= 120 &&
    m.bust >= m.underBust && m.bust - m.underBust <= 40;

  if (!valid) {
    return {
      band: 0,
      sizeTermId: "",
      cupTermId: null,
      explanation: "",
      alternates: [],
      valid: false,
      inputError:
        "اندازه‌ها را چک کن: زیر سینه بین ۵۸ تا ۱۲۰ سانت و دور سینه باید بزرگ‌تر یا مساوی زیر سینه باشد.",
    };
  }

  // ۱) سایز پایه از سایزچارت
  const row = BAND_CHART.find((r) => m.underBust >= r.min && m.underBust <= r.max);
  let band = row?.band ?? (m.underBust < BAND_CHART[0].min ? BAND_CHART[0].band : BAND_CHART[BAND_CHART.length - 1].band);
  const onEdge = row == null;

  // ۲) کاپ از تفاضل — نزدیک‌ترین پله زوج
  const diff = m.bust - m.underBust;
  let cup = [...CUP_CHART].sort((a, b) => Math.abs(a.diff - diff) - Math.abs(b.diff - diff))[0].cup;
  const cupNote: string[] = [];

  // ۳) قواعد برند/مدل (اولویت: قاعده محصول، بعد برند — هر دو می‌توانند اعمال شوند)
  const productRule = FIT_RULES.find((r) => r.productId && r.productId === opts.productId);
  const brandRule = FIT_RULES.find((r) => !r.productId && r.brandId === opts.brandId);
  const applied: string[] = [];
  const shiftBand = (dir?: "up" | "down") => {
    if (!dir) return;
    const next = band + (dir === "up" ? 5 : -5);
    if (next >= 65 && next <= 95) {
      band = next;
      applied.push(dir === "up" ? "فنر یک سایز درشت‌تر (فیت برند/مدل)" : "فنر یک سایز کوچک‌تر (فیت برند/مدل)");
    }
  };
  const shiftCup = (dir?: "up" | "down") => {
    if (!dir) return;
    const idx = CUP_CHART.findIndex((c) => c.cup === cup);
    const next = CUP_CHART[idx + (dir === "up" ? 1 : -1)];
    if (next) {
      cup = next.cup;
      cupNote.push(dir === "up" ? "کاپ یک پله درشت‌تر" : "کاپ یک پله کوچک‌تر");
    }
  };
  if (productRule) {
    shiftBand(productRule.bandShift);
    shiftCup(productRule.cupShift);
    applied.push(productRule.note);
  }
  if (brandRule) {
    shiftBand(brandRule.bandShift);
    shiftCup(brandRule.cupShift);
    applied.push(brandRule.note);
  }

  // ۴) sister size به‌عنوان جایگزین‌های نزدیک (بند ۴۲: سایز محاسبه‌شده = حقیقت مطلق نیست)
  const alternates: string[] = [];
  if (band + 5 <= 95) alternates.push(`${band + 5}/${shiftCupLetter(cup, -1)}`);
  if (band - 5 >= 65) alternates.push(`${band - 5}/${shiftCupLetter(cup, 1)}`);

  const explanation = [
    `دور زیر سینه ${Math.round(m.underBust)} سانت → فنر ${band}`,
    `تفاضل ${Math.round(diff)} سانت → کاپ ${cup}`,
    onEdge ? " (زیر سینه‌ات مرز جدول بود؛ هر دو سایز مجاور را در نظر بگیر)" : "",
    ...applied.map((a) => ` — ${a}`),
  ].join("");

  return {
    band,
    sizeTermId: `sz-${band}`,
    cupTermId: cupTermIdOf(cup),
    explanation,
    alternates,
    valid: true,
  };
}

function shiftCupLetter(cup: string, delta: number): string {
  const idx = CUP_CHART.findIndex((c) => c.cup === cup);
  const next = CUP_CHART[Math.min(CUP_CHART.length - 1, Math.max(0, idx + delta))];
  return next.cup;
}

/**
 * سایز حرفی (S..XL) برای دسته‌های غیر سوتین — از دور زیر سینه تقریبی
 * (بند ۴۳: توصیه با ذکر تقریبی بودن؛ برای شورت/لباس خواب/ورزشی/گن).
 */
export function recommendLetterSize(underBust: number): SizeRecommendation {
  const valid = Number.isFinite(underBust) && underBust >= 58 && underBust <= 120;
  if (!valid) {
    return {
      band: 0, sizeTermId: "", cupTermId: null, explanation: "", alternates: [],
      valid: false, inputError: "دور زیر سینه را بین ۵۸ تا ۱۲۰ سانت وارد کن.",
    };
  }
  const table: Array<{ max: number; letter: string }> = [
    { max: 71, letter: "S" },
    { max: 78, letter: "M" },
    { max: 85, letter: "L" },
    { max: 92, letter: "XL" },
  ];
  const letter = table.find((t) => underBust <= t.max)?.letter ?? "XL";
  return {
    band: 0,
    sizeTermId: `sz-${letter}`,
    cupTermId: null,
    explanation: `بر اساس دور زیر سینه ${Math.round(underBust)} سانت → سایز تقریبی ${letter}. برای فیت دقیق‌تر، جدول راهنمای همان محصول را ببین.`,
    alternates: [],
    valid: true,
  };
}

/** دسته‌ای بودن جریان سوتین‌محور (بند ۴۳: برای سوتین/ست) */
export function isBraLike(category: CategorySlug): boolean {
  return category === "bra" || category === "set";
}
