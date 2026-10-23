import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { CmsRenderer } from "@ghasedak/blocks";
import { loadCatalog } from "@/lib/catalog-repo";
import {
  buildCmsData,
  fetchCmsPage,
  isPreview,
  loadLiveBrands,
  loadLiveCategories,
  loadLiveContentNav,
  resolveCmsSlot,
} from "@/lib/cms";
import CmsPreviewSurface from "@/components/cms/CmsPreviewSurface";

/**
 * صفحاتی که مدیر در صفحه‌ساز ساخته و منتشر کرده است.
 *
 * چرا امن است که این مسیر کنار مسیرهای ثابت وجود دارد؟
 *  Next.js مسیرهای ایستا را بر مسیر پویا ترجیح می‌دهد، پس `/about`،
 *  `/cart`، `/c/bra` و بقیه همچنان همان فایل‌های خودشان را می‌گیرند.
 *  این مسیر فقط slugهایی را می‌گیرد که در `CmsPage` منتشر شده‌اند؛
 *  هر چیز دیگری `notFound()` می‌خورد — یعنی حدس زدن slug نتیجه‌ای ندارد.
 */

export const dynamic = "force-dynamic";

/** مسیرهایی که هرگز نباید به صفحه‌ساز بروند (ریشهٔ فروشگاه خودشان هستند) */
const RESERVED = new Set(["api", "c", "p", "checkout", "cart", "order", "account", "need", "search", "wishlist", "guides"]);

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const res = await fetchCmsPage(slug);
  if (!res) return {};
  const seo = res.page.seo;
  return {
    title: seo?.title || res.page.title,
    description: seo?.description,
    ...(seo?.noIndex ? { robots: { index: false, follow: false } } : {}),
    alternates: { canonical: `/${slug}` },
  };
}

export default async function CmsSlugPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const clean = String(slug ?? "").toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(clean) || RESERVED.has(clean)) notFound();

  const previewMode = isPreview(await searchParams);
  const slot = await resolveCmsSlot(clean, previewMode);
  if (!slot.page && !slot.previewMode) notFound();

  const products = await loadCatalog();
  await Promise.all([loadLiveCategories(), loadLiveBrands(), loadLiveContentNav()]);
  const data = buildCmsData(products);

  // حالت پیش‌نمایش: همان صفحه ولی زنده و قابل‌ویرایش از داخل پنل
  if (slot.previewMode) {
    return <CmsPreviewSurface page={slot.page ?? { version: 1, title: "", blocks: [] }} data={data} />;
  }
  return <CmsRenderer page={slot.page!} data={data} />;
}
