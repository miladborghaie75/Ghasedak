import { newBlockId, normalizeCmsPage, type CmsBlock, type CmsPageData } from "../cms";
import { ABOUT_CONTENT } from "./about";
import { CONTACT_CONTENT } from "./contact";
import { PRIVACY_CONTENT } from "./privacy";
import { RETURNS_CONTENT } from "./returns";
import { SHIPPING_CONTENT } from "./shipping";
import { TERMS_CONTENT } from "./terms";
import { paragraphText, type SiteContentBlock, type SiteContentPage } from "./types";

export * from "./types";
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
 * سقفِ متنِ هر بلوک.
 *
 * چرا؟ چون فیلد `textarea` در قراردادِ بلوک‌ها تا ۲۰۰۰ نویسه نگه می‌دارد و
 * متنِ بلندتر **بی‌صدا** بریده می‌شود — یعنی صفحه‌ای که مدیر می‌بیند با
 * متنی که در سایت منتشر می‌شود فرق می‌کند. پس متنِ بلند را خودمان به
 * چند بلوکِ پشت‌سرهم می‌شکنیم.
 */
const MAX_BLOCK_TEXT = 1500;

/** شکستنِ متنِ بلند به تکه‌هایی که هرکدام در یک بلوک جا شوند */
export function splitSiteText(text: string, max = MAX_BLOCK_TEXT): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < 200) cut = rest.lastIndexOf("\n", max);
    if (cut < 200) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * تبدیلِ **وفادارانه** صفحهٔ ایستا به صفحهٔ CMS.
 *
 * «وفادارانه» یعنی: همان متن، همان ترتیب بخش‌ها، همان تیترها — بدون اینکه
 * چیزی کم یا اضافه شود. برای همین متن از همان منبعِ مشترکی می‌آید که
 * سایت رندر می‌کند (نه از یک کپیِ دیگر).
 */
export function siteContentToCmsPage(content: SiteContentPage, title: string): CmsPageData {
  const blocks: CmsBlock[] = [
    {
      id: newBlockId(),
      type: "HERO",
      props: { title, subtitle: content.intro ?? "", align: "start" },
    },
  ];

  for (const section of content.sections) {
    const text = section.blocks
      .map((b) => siteBlockText(b))
      .filter((t) => t.trim().length > 0)
      .join("\n\n");
    if (!text.trim()) continue;
    for (const chunk of splitSiteText(text)) {
      blocks.push({
        id: newBlockId(),
        type: "RICH_TEXT",
        props: { title: section.title ?? "", text: chunk, align: "start" },
      });
    }
  }

  return normalizeCmsPage({
    version: 1,
    title,
    seo: { title, description: content.intro ?? "" },
    blocks,
  });
}
