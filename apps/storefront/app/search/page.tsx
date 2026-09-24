import type { Metadata } from "next";
import Link from "next/link";
import { ProductGrid } from "@/components/commerce/ProductGrid";
import { faNum } from "@/lib/format";
import { getAllProductsV2, searchV2 } from "@/lib/catalog-repo";
import { CATEGORIES } from "@/lib/categories";
import { NEEDS, matchesNeed } from "@/lib/needs";

export const metadata: Metadata = { title: "جستجو" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const needSlug = typeof sp.need === "string" ? sp.need : "";

  const need = NEEDS.find((n) => n.slug === needSlug);
  const results = need
    ? getAllProductsV2().filter((p) => matchesNeed(p, need))
    : searchV2(q);

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 sm:px-4">
      <h1 className="font-display text-3xl text-plum">
        {q ? `جستجو: «${q}»` : need ? need.label : "جستجو"}
      </h1>

      {results.length === 0 ? (
        <div className="mt-6 flex flex-col items-center gap-4 rounded-card border border-dashed border-line bg-surface px-6 py-16 text-center">
          <p className="text-sm font-bold text-ink">نتیجه‌ای پیدا نشد</p>
          <p className="max-w-sm text-[13px] leading-7 text-muted">
            املای عبارت را بررسی کنید یا از دسته‌ها شروع کنید:
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
          <p className="mt-2 mb-4 text-[13px] text-muted tnum">
            {faNum(results.length)} محصول پیدا شد
            {need ? ` — ${need.why}` : ""}
          </p>
          <ProductGrid products={results} />
        </>
      )}
    </div>
  );
}
