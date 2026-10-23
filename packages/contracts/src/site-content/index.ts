import { newBlockId, normalizeCmsPage, type CmsBlock, type CmsPageData } from "../cms";
import { ABOUT_CONTENT } from "./about";
import { CONTACT_CONTENT } from "./contact";
import { PRIVACY_CONTENT } from "./privacy";
import { RETURNS_CONTENT } from "./returns";
import { SHIPPING_CONTENT } from "./shipping";
import { TERMS_CONTENT } from "./terms";
import { bodyToBlocks, sectionToBody } from "./markup";
import { paragraphText, type SiteContentBlock, type SiteContentPage } from "./types";

export * from "./types";
export * from "./markup";
export { ABOUT_CONTENT } from "./about";
export { CONTACT_CONTENT } from "./contact";
export { PRIVACY_CONTENT } from "./privacy";
export { RETURNS_CONTENT } from "./returns";
export { SHIPPING_CONTENT } from "./shipping";
export { TERMS_CONTENT } from "./terms";

/**
 * همهٔ صفحه‌هایی که محتوایِ مشترک دارند — کلید، همان slug صفحه در CMS است.
 *
 * هر مسیری که اینجا نباشد، محتوایِ ثابتِ دیگری دارد (یا اصلاً صفحه‌ای
 * ندارد) و «ساخت صفحه از محتوای فعلی» رویش معنا ندارد.
 */
export const SITE_CONTENT_PAGES: Record<string, SiteContentPage> = {
  about: ABOUT_CONTENT,
  contact: CONTACT_CONTENT,
  returns: RETURNS_CONTENT,
  shipping: SHIPPING_CONTENT,
  privacy: PRIVACY_CONTENT,
  terms: TERMS_CONTENT,
};

/** محتوای مشترکِ یک مسیر — اگر مسیر چنین محتوایی نداشته باشد `undefined` */
export function siteContentBySlug(slug: string): SiteContentPage | undefined {
  return SITE_CONTENT_PAGES[String(slug ?? "").trim().toLowerCase()];
}

/** متنِ خامِ یک بند (پیوندها و نشانه‌گذاری حذف می‌شوند) */
export function siteBlockText(block: SiteContentBlock): string {
  if (block.kind === "list") {
    return block.items.map((item) => paragraphText(item)).join("\n");
  }
  return paragraphText(block.text);
}

/**
 * تبدیلِ **وفادارانه** صفحهٔ ایستا به صفحهٔ صفحه‌ساز.
 *
 * «وفادارانه» یعنی: همان متن، همان ترتیب بخش‌ها، همان تیترها، همان پیوندها —
 * بدون اینکه چیزی کم یا زیاد شود. نتیجه **یک** بلوک `CONTENT_PAGE` است، نه
 * هیرو + ده‌ها بلوک متن: صفحه‌های محتوایی در سایت هیرو ندارند و صفحه‌ساز هم
 * نباید بسازد. متنِ هر بخش با نشانه‌گذاریِ `site-content/markup` ذخیره می‌شود
 * تا مدیر همان ساختار (پاراگراف/فهرست/یادداشت/پیوند) را ببیند و ویرایش کند.
 */
export function siteContentToCmsPage(content: SiteContentPage, title: string): CmsPageData {
  const sections = content.sections.map((section) => ({
    title: section.title ?? "",
    body: sectionToBody(section),
  }));

  const blocks: CmsBlock[] = [
    {
      id: newBlockId(),
      type: "CONTENT_PAGE",
      props: { intro: content.intro ?? "", updated: content.updated ?? "", sections },
    },
  ];

  return normalizeCmsPage({
    version: 1,
    title,
    seo: { title, description: content.intro ?? "" },
    blocks,
  });
}

/**
 * وارونِ `siteContentToCmsPage` — صفحهٔ صفحه‌ساز را به مدلِ محتوای مشترک
 * برمی‌گرداند. برای تستِ «چیزی گم نشده» و برای هر مقایسهٔ دوطرفه لازم است:
 * اگر تبدیل رو به جلو چیزی را بشکند، این تابع همان شکستگی را آشکار می‌کند.
 */
export function contentPageToSiteContent(page: CmsPageData): SiteContentPage | undefined {
  const block = page.blocks.find((b) => b.type === "CONTENT_PAGE");
  if (!block) return undefined;
  const intro = typeof block.props.intro === "string" ? block.props.intro : "";
  const updated = typeof block.props.updated === "string" ? block.props.updated : "";
  const rawRows = Array.isArray(block.props.sections) ? block.props.sections : [];
  const sections = rawRows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => ({
      title: typeof row.title === "string" ? row.title : "",
      blocks: bodyToBlocks(typeof row.body === "string" ? row.body : ""),
    }));
  return { slug: "", ...(intro ? { intro } : {}), ...(updated ? { updated } : {}), sections };
}
