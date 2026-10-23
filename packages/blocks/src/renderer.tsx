import type { CmsBlockType, CmsPageData } from "@ghasedak/contracts";
import type { CmsBlockProps, CmsData } from "./types";
import {
  ArtShowcaseBlock,
  BannerBlock,
  BrandGridBlock,
  CategoryGridBlock,
  FaqBlock,
  FeatureTripleBlock,
  HeroBlock,
  ImageTextBlock,
  NewsletterBlock,
  ProductCarouselBlock,
  ProductGridBlock,
  RichTextBlock,
  SpacerBlock,
  StatsBlock,
  TestimonialsBlock,
  TrustBarBlock,
} from "./blocks/index";
import { ContentPageBlock } from "./content-page";

/**
 * رجیستری رندر — نگاشت `type` به کامپوننت.
 *
 * تنها یک جای کد باید با افزودن بلوک تازه تغییر کند؛ همین رجیستری در
 * فروشگاه (صفحهٔ واقعی) و در ادمین (پیش‌نمایش زنده) استفاده می‌شود، پس
 * آنچه در بوم دیده می‌شود دقیقاً همان رندرِ سایت است.
 */

export type CmsRendererFn = (args: CmsBlockProps) => React.ReactElement | null;

export const CMS_RENDERERS: Record<CmsBlockType, CmsRendererFn> = {
  HERO: HeroBlock,
  ART_SHOWCASE: ArtShowcaseBlock,
  BANNER: BannerBlock,
  BRAND_GRID: BrandGridBlock,
  CATEGORY_GRID: CategoryGridBlock,
  PRODUCT_CAROUSEL: ProductCarouselBlock,
  PRODUCT_GRID: ProductGridBlock,
  FEATURE_TRIPLE: FeatureTripleBlock,
  IMAGE_TEXT: ImageTextBlock,
  RICH_TEXT: RichTextBlock,
  CONTENT_PAGE: ContentPageBlock,
  STATS: StatsBlock,
  FAQ: FaqBlock,
  TESTIMONIALS: TestimonialsBlock,
  TRUST_BAR: TrustBarBlock,
  NEWSLETTER: NewsletterBlock,
  SPACER: SpacerBlock,
};

/**
 * رندر یک بلوک تنها.
 *
 * اگر نوعی رندرر نداشته باشد (payload دست‌کاری‌شده یا بلوکِ آینده روی دادهٔ
 * قدیمی)، بی‌صدا ناپدید نمی‌شود: هم هشدار توسعه‌ای می‌دهد هم یک گرهٔ خالی
 * برمی‌گرداند تا خوردنِ بی‌صدا قابل پیگیری باشد.
 */
export function CmsBlockView({ block, data, pageTitle }: CmsBlockProps) {
  const fn = CMS_RENDERERS[block.type];
  if (!fn) {
    console.warn(`[cms] رندرری برای بلوک «${block.type}» ثبت نشده است.`);
    return null;
  }
  return fn({ block, data, pageTitle });
}

/** رندر کل صفحه — ترتیب بلوک‌ها همان چیزی است که مدیر چیده */
export function CmsRenderer({
  page,
  data,
  includeHidden = false,
}: {
  page: CmsPageData;
  data: CmsData;
  includeHidden?: boolean;
}) {
  const blocks = includeHidden ? page.blocks : page.blocks.filter((b) => !b.hidden);
  if (blocks.length === 0) return null;
  return (
    <div data-cms-page={page.title} className="flex flex-col">
      {blocks.map((block) => (
        <div key={block.id} data-block-id={block.id}>
          <CmsBlockView block={block} data={data} pageTitle={page.title} />
        </div>
      ))}
    </div>
  );
}
