import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ProductCard } from "@/components/commerce/ProductCard";
import { loadCatalog, hasAnyStock } from "@/lib/catalog-repo";
import {
  loadNeedFinderSteps,
  matchesNeed,
  collectNeedFilters,
  parseNeedAnswers,
  findOption,
  needTermLabels,
} from "@/lib/needs";
import { getTerm } from "@/lib/attributes";
import { faNum } from "@/lib/format";

export const metadata: Metadata = {
  title: "پیشنهادهای من — قاصدک",
  description: "نتیجهٔ ویزارد انتخاب — محصولات منطبق با دلیل انطباق.",
};

/** داده از API واقعی — رندر داینامیک */
export const dynamic = "force-dynamic";

/**
 * نتیجهٔ ویزارد (گام ۱۶) — URL اشتراک‌پذیر: /need/result?a0=sport&a1=…&a2=…
 * رندر سروری؛ انطباق AND بین گام‌ها. پاسخ ناقص/ناشناخته → برگرد به ویزارد.
 */
export default async function NeedResultPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [sp, steps] = await Promise.all([searchParams, loadNeedFinderSteps()]);
  const answers = parseNeedAnswers(sp, steps);
  if (answers.length < steps.length) redirect("/need");

  const options = answers.map((id, i) => findOption(steps, i, id));
  const rules = options.map((o) => o?.rule ?? null);

  const catalog = await loadCatalog();
  const all = catalog.filter(hasAnyStock);
  const matches = all.filter((p) => matchesNeed(p, rules));
  const closeMatches = matches.length < 4 ? all.filter((p) => !matches.includes(p)).slice(0, 4) : [];

  // دلیل انطباق — از همان ruleها: چرا این محصول (بند ۹)
  const { attributeTerms, priceMax } = collectNeedFilters(rules);
  const termLabels = needTermLabels(catalog);
  const reasons: string[] = [];
  const why = options[0]?.rule?.why;
  if (why) reasons.push(why);
  if (attributeTerms.length)
    reasons.push(`جنس ${attributeTerms.map((t) => termLabels.get(t) ?? safeTerm(t)).join(" یا ")}`);
  if (priceMax != null) reasons.push(`بودجه تا ${faNum(priceMax)} تومان`);
  const reason = reasons.length ? reasons.join(" · ") : "همه محصولات";

  return (
    <div className="mx-auto max-w-7xl px-3 py-8 sm:px-4">
      <div className="rounded-3xl border border-line bg-surface p-5 shadow-clay-1 sm:p-7">
        <div className="flex items-center justify-between gap-3">
          <h1 className="font-display text-2xl text-plum">پیشنهادهای قاصدک</h1>
          <Link
            href={`/need?start=${encodeURIComponent(answers[0])}`}
            className="inline-flex h-9 items-center rounded-full border border-line px-4 text-[13px] font-semibold text-ink hover:bg-primary-tint"
          >
            تغییر پاسخ‌ها
          </Link>
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
              href={`/search?need=${encodeURIComponent(answers[0])}`}
              className="mt-4 inline-flex h-11 items-center rounded-full border border-line bg-surface px-5 text-[13px] font-semibold text-primary-strong hover:bg-primary-tint"
            >
              مشاهده همه محصولات
            </Link>
          </>
        ) : (
          <div className="mt-5 rounded-2xl border border-dashed border-line p-6 text-center">
            <p className="text-sm font-semibold text-ink">با این ترکیب، محصول دقیقی نداریم</p>
            <p className="mt-1 text-[13px] text-muted">
              نزدیک‌ترین‌ها را ببین یا پاسخ‌هایت را تغییر بده.
            </p>
          </div>
        )}
      </div>

      {/* نزدیک‌ترین‌ها اگر انطباق کم بود */}
      {matches.length < 4 && closeMatches.length > 0 && (
        <section className="mt-6" aria-label="نزدیک‌ترین پیشنهادها">
          <h2 className="mb-3 text-[15px] font-bold text-ink">نزدیک‌ترین‌ها</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {closeMatches.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
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
