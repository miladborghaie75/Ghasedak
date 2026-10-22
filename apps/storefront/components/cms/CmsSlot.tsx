import type { ReactNode } from "react";
import { CmsRenderer } from "@ghasedak/blocks";
import type { CmsPageData } from "@ghasedak/contracts";
import {
  buildCmsData,
  isPreview,
  loadLiveBrands,
  loadLiveCategories,
  resolveCmsSlot,
  type PreviewParams,
} from "@/lib/cms";
import { loadCatalog } from "@/lib/catalog-repo";
import type { ProductV2 } from "@/lib/catalog";
import CmsPreviewSurface from "./CmsPreviewSurface";

/** صفحهٔ خالی — وقتی هنوز هیچ صفحه‌ای برای این مسیر ساخته نشده */
const EMPTY_PAGE: CmsPageData = { version: 1, title: "", blocks: [] };

/**
 * جایگاه صفحه‌ساز روی یک مسیر واقعی سایت.
 *
 * رفتار:
 *  ۱) اگر برای این مسیر صفحه‌ای در صفحه‌ساز نیست → `fallback` (چیدمان
 *     پیش‌فرض همان مسیر) نمایش داده می‌شود. یعنی تا وقتی مدیر چیزی
 *     نساخته، سایت دقیقاً مثل قبل کار می‌کند.
 *  ۲) اگر صفحه هست و درخواست عادی است → `CmsRenderer` بلوک‌ها را رندر می‌کند.
 *  ۳) اگر صفحه هست و درخواست با `?cmsPreview=1` آمده → `CmsPreviewSurface`
 *     رندر می‌شود: همان صفحه، ولی زنده و قابل‌ویرایش از داخل پنل.
 *
 * همهٔ داده‌ها از API می‌آید (بند ۵) — فروشگاه مستقیم DB را نمی‌خواند.
 */
export default async function CmsSlot({
  slug,
  fallback,
  products,
  searchParams,
}: {
  slug: string;
  fallback?: ReactNode;
  /** اگر از قبل کاتالوگ بارگذاری شده، همان را می‌گیریم (کش مشترک دارد) */
  products?: ProductV2[];
  /** پارامترهای جست‌وجوی صفحه — برای تشخیص `?cmsPreview=1` */
  searchParams?: Promise<PreviewParams>;
}) {
  const previewMode = isPreview(await searchParams);
  const slot = await resolveCmsSlot(slug, previewMode);
  const list = products ?? (await loadCatalog());
  await Promise.all([loadLiveCategories(), loadLiveBrands()]);
  const data = buildCmsData(list);

  // ── حالت پیش‌نمایش: همیشه «سطح پیش‌نمایش» رندر می‌شود، حتی اگر هنوز
  //    صفحه‌ای وجود نداشته باشد. دلیلش این است که پنل باید بتواند صفحهٔ
  //    پیش‌نویس را از طریق پیام بفرستد و بوم زنده شود؛ اگر اینجا به
  //    چیدمان پیش‌فرض برگردیم، پنل هیچ چیزی برای حرف‌زدن پیدا نمی‌کند.
  //
  //    اگر هنوز صفحه‌ای برای این مسیر نیست، `fallback` (چیدمانِ واقعیِ
  //    همان مسیر) داخل سطح پیش‌نمایش رندر می‌شود — یعنی بومِ صفحه‌ساز
  //    همان چیزی را نشان می‌دهد که بازدیدکننده می‌بیند، و پلِ پیام هم فعال
  //    می‌ماند تا بعد از «ساخت صفحه» بلوک‌ها زنده شوند.
  if (slot.previewMode) {
    return <CmsPreviewSurface page={slot.page ?? EMPTY_PAGE} data={data} fallback={fallback} />;
  }

  if (!slot.page) return <>{fallback ?? null}</>;
  return <CmsRenderer page={slot.page} data={data} />;
}
