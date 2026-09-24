import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ProductGrid } from "@/components/commerce/ProductGrid";
import { CategoryFiltersBar } from "@/components/commerce/CategoryFiltersBar";
import {
  applyFiltersV2,
  getAllProductsV2,
  getProductsByCategoryV2,
  parseFiltersV2,
} from "@/lib/catalog-repo";
import { CATEGORIES, getCategoryBySlug } from "@/lib/categories";
import { sortV2 } from "@/lib/catalog-repo";
import { parseSortParam } from "@/lib/sort";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export function generateStaticParams() {
  return CATEGORIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const cat = getCategoryBySlug(slug);
  if (!cat) return {};
  return {
    title: `${cat.name} — خرید آنلاین`,
    description: cat.blurb,
  };
}

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const sp = await searchParams;
  const cat = getCategoryBySlug(slug);
  if (!cat) notFound();

  const filters = parseFiltersV2(sp);
  const sort = parseSortParam(sp);

  const inCategory = getProductsByCategoryV2(cat.id);
  const filtered = applyFiltersV2(inCategory, filters);
  const sorted = sortV2(filtered, sort);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: cat.name,
    numberOfItems: sorted.length,
  };

  return (
    <div className="mx-auto max-w-7xl px-3 sm:px-4">
      <nav aria-label="مسیر صفحه" className="py-3 text-[12px] text-muted">
        <ol className="flex items-center gap-1.5">
          <li><Link href="/" className="hover:text-primary-strong">خانه</Link></li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="font-bold text-ink">{cat.name}</li>
        </ol>
      </nav>

      {/* هدر فشرده: عنوان + شمارش یک ردیف (بند ۲۴) */}
      <header className="mb-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl text-plum">{cat.name}</h1>
          <span className="rounded-full bg-primary-tint px-3 py-1 text-[12px] font-bold text-primary-strong tnum">
            {sorted.length} محصول
          </span>
        </div>
        <p className="mt-1 text-[13px] leading-7 text-muted">{cat.blurb}</p>
      </header>

      <CategoryFiltersBar category={cat.id} filters={filters} sort={sort} />

      <ProductGrid products={sorted} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
    </div>
  );
}
