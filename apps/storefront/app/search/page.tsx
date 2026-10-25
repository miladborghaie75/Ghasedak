import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/commerce/ProductGrid";
import { SortSelect } from "@/components/commerce/SortSelect";
import { faNum } from "@/lib/format";
import { loadCatalog, searchV2, sortV2 } from "@/lib/catalog-repo";
import { parseSortParam } from "@/lib/sort";
import { CATEGORIES } from "@/lib/categories";
import { loadNeedFinderSteps, matchesNeed } from "@/lib/needs";
import { COPY } from "@/lib/copy";
import { TrackOnMount } from "@/components/analytics/TrackOnMount";

export const metadata: Metadata = {
  title: COPY.search,
  // کانونیکال بدون پارامتر — نسخه‌های ?q=... جایگزین نشوند
  alternates: { canonical: "/search" },
};

/** داده از API واقعی — رندر داینامیک */
export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const needSlug = typeof sp.need === "string" ? sp.need : "";
  const [all, steps] = await Promise.all([loadCatalog(), loadNeedFinderSteps()]);

  // گام ۱۶: `need` = id گزینهٔ گام ۱ ویزارد (تک‌منبع) — با rule همان گزینه فیلتر می‌کنیم
  const situation = needSlug ? steps[0]?.options.find((o) => o.id === needSlug) : undefined;
  const sort = parseSortParam(sp);
  // مرتب‌سازی مثل صفحهٔ دسته — همان قاعدهٔ lib/sort.ts (تک‌منبع):
  // «بیشترین امتیاز» فقط از نظر تأییدشده می‌آید و بی‌نظرها پایین می‌مانند.
  const matched = situation
    ? all.filter((p) => matchesNeed(p, [situation.rule]))
    : searchV2(q, all);
  const results = sortV2(matched, sort);

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 sm:px-4">
      {/* گام ۱۵ — رویداد search از تک‌نقطهٔ ورود به این صفحه (گارد رضایت داخل track) */}
      {q ? <TrackOnMount event="search" params={{ search_term: q }} /> : null}
      <h1 className="font-display text-3xl text-plum">
        {q ? `جستجو: «${q}»` : situation ? situation.label : COPY.search}
      </h1>

      {results.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-card border border-dashed border-line bg-surface px-6 py-16 text-center">
          <p className="text-sm font-bold text-ink">نتیجه‌ای پیدا نشد</p>
          <p className="max-w-sm text-[13px] leading-7 text-muted">
            املای عبارت را بررسی کن یا از دسته‌ها شروع کن:
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {CATEGORIES.map((c) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="inline-flex h-10 items-center rounded-full border border-line bg-surface px-4 text-[13px] font-bold text-primary-strong hover:bg-primary-tint">
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mt-2 mb-4 flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface/95 px-3 py-2.5 shadow-clay-1">
            <p className="text-[13px] text-muted tnum">
              {faNum(results.length)} محصول پیدا شد
            </p>
            {situation?.rule?.why && <p className="text-[12px] text-muted">{situation.rule.why}</p>}
            <SortSelect sort={sort} className="ms-auto" />
          </div>
          <ProductGrid products={results} />
        </>
      )}
    </div>
  );
}
