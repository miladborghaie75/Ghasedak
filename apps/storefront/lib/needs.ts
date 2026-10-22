import type {
  NeedFinderOptionDTO,
  NeedFinderStepDTO,
  NeedRule,
} from "@ghasedak/contracts";
import { NEED_FINDER_FALLBACK } from "@ghasedak/contracts";
import type { ProductV2 } from "./catalog";

/**
 * Need-based discovery (بند ۹/۲۰، گام ۱۶) — دیتابیس‌محور.
 * گام‌ها/گزینه‌ها از API عمومی (`/api/v1/need-finder/steps`) می‌آیند؛ اگر API
 * در دسترس نبود همان fallback تک‌منبع (contracts) نشان داده می‌شود —
 * پس seed و فروشگاه هرگز واگرا نمی‌شوند.
 *
 * منطق انطباق در همین فایل است (نه در کامپوننت) تا مستقل تست شود:
 * داخل هر بُعد OR، بین گام‌ها AND؛ rule خالی = بدون محدودیت.
 *
 * این فایل عمداً وابستگی runtime به catalog-repo ندارد (فقط type) تا با
 * `node --experimental-strip-types --test` قابل اجرا باشد.
 */

const TTL_MS = 60_000;

const g = globalThis as unknown as { __ghNeedSteps?: { at: number; steps: NeedFinderStepDTO[] } };

/** بارگذاری گام‌های ویزارد — سرور (RSC)؛ کش ماژول‌سطح با TTL کوتاه + fallback */
export async function loadNeedFinderSteps(): Promise<NeedFinderStepDTO[]> {
  const cached = g.__ghNeedSteps;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.steps;

  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const r = await fetch(`${api}/api/v1/need-finder/steps`, {
      next: { revalidate: 60 },
      signal: AbortSignal.timeout(4_000),
    });
    if (r.ok) {
      const steps = (await r.json()) as NeedFinderStepDTO[];
      if (Array.isArray(steps) && steps.length && steps.every((s) => s?.options?.length)) {
        g.__ghNeedSteps = { at: Date.now(), steps };
        return steps;
      }
    }
  } catch {
    // فالو به fallback — فروشگاه بدون API هم ویزارد دارد
  }
  g.__ghNeedSteps = { at: Date.now(), steps: NEED_FINDER_FALLBACK };
  return NEED_FINDER_FALLBACK;
}

/** حداقل قیمت مؤثر محصول — تخفیف فعال ملاک است (همان معنای minPrice کاتالوگ) */
function effectiveMinPrice(p: ProductV2): number {
  let min = Infinity;
  for (const v of p.variants) min = Math.min(min, v.salePrice ?? v.price);
  return min;
}

/**
 * انطباق یک محصول با قواعد گزینه‌های انتخاب‌شده (AND بین گام‌ها، OR داخل هر بُعد).
 * قاعدهٔ null/خالی = بدون محدودیت — «مهم نیست» هیچ محصولی را حذف نمی‌کند.
 *
 * جنس: قاعده slug ترم را نگه می‌دارد («پنبه») — slug پایدار است و به id ساخته‌شده
 * وابسته نیست. برای دادهٔ قدیمی که id ترم را نگه داشته، id هم پذیرفته می‌شود.
 */
export function matchesNeed(
  p: ProductV2,
  rules: Array<NeedRule | null | undefined>,
): boolean {
  let priceMax: number | null = null;
  for (const rule of rules) {
    if (!rule) continue;
    if (rule.categories?.length && !rule.categories.includes(p.category)) return false;
    if (rule.attributeTerms?.length && !rule.attributeTerms.some((t) => hasAttributeTerm(p, t)))
      return false;
    if (rule.priceMax != null)
      priceMax = priceMax == null ? rule.priceMax : Math.min(priceMax, rule.priceMax);
  }
  if (priceMax != null && effectiveMinPrice(p) > priceMax) return false;
  return true;
}

/** آیا محصول این ترم را دارد؟ — با slug (راه اصلی) یا id (دادهٔ قدیمی) */
function hasAttributeTerm(p: ProductV2, term: string): boolean {
  if (p.attributeIds.includes(term)) return true;
  return (p.attributeTerms ?? []).some((t) => t.slug === term || t.id === term);
}

/**
 * برچسب نمایشی ترم‌های قاعده — از روی کاتالوگ واقعی (slug → مقدار فارسی).
 * اگر ترمی در کاتالوگ نبود، همان متن قاعده برگردانده می‌شود.
 */
export function needTermLabels(products: ProductV2[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of products) {
    for (const t of p.attributeTerms ?? []) {
      map.set(t.slug, t.value);
      map.set(t.id, t.value);
    }
  }
  return map;
}

/** تجمیع ابعاد از چند قاعده برای متن دلیل: جنس‌ها (OR) + سقف بودجه (min) */
export function collectNeedFilters(rules: Array<NeedRule | null | undefined>): {
  categories: string[];
  attributeTerms: string[];
  priceMax: number | null;
} {
  const categories: string[] = [];
  const attributeTerms: string[] = [];
  let priceMax: number | null = null;
  for (const rule of rules) {
    if (!rule) continue;
    for (const c of rule.categories ?? [])
      if (!categories.includes(c)) categories.push(c);
    for (const t of rule.attributeTerms ?? [])
      if (!attributeTerms.includes(t)) attributeTerms.push(t);
    if (rule.priceMax != null)
      priceMax = priceMax == null ? rule.priceMax : Math.min(priceMax, rule.priceMax);
  }
  return { categories, attributeTerms, priceMax };
}

/* ── URL نتیجهٔ اشتراک‌پذیر: /need/result?a0=…&a1=…&a2=… ───────────── */

/** ساخت لینک نتیجه از پاسخ‌های گام‌ها (به‌ترتیب گام) */
export function buildNeedResultHref(answers: string[]): string {
  const qs = new URLSearchParams();
  answers.forEach((a, i) => qs.set(`a${i}`, a));
  return `/need/result?${qs.toString()}`;
}

/**
 * خواندن پاسخ‌ها از URL و اعتبارسنجی در برابر گام‌های واقعی —
 * id ناشناخته حذف می‌شود (مهم: URL ورودی هرگز به کوئری DB نمی‌رسد).
 */
export function parseNeedAnswers(
  sp: Record<string, string | string[] | undefined>,
  steps: NeedFinderStepDTO[],
): string[] {
  const out: string[] = [];
  steps.forEach((step, i) => {
    const raw = sp[`a${i}`];
    const id = typeof raw === "string" ? raw : Array.isArray(raw) ? raw[0] : undefined;
    if (id && step.options.some((o) => o.id === id)) out.push(id);
  });
  return out;
}

/** یافتن گزینهٔ انتخاب‌شدهٔ یک گام (برای لیبل/دلیل) */
export function findOption(
  steps: NeedFinderStepDTO[],
  stepIndex: number,
  optionId: string | undefined,
): NeedFinderOptionDTO | undefined {
  if (!optionId) return undefined;
  return steps[stepIndex]?.options.find((o) => o.id === optionId);
}
