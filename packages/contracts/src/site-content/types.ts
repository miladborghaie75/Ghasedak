/**
 * مدل محتوای صفحه‌های ایستا (قانونی/معرفی).
 *
 * چرا یک مدل داده و نه فقط رشته؟ چون همین محتوا دو جا مصرف می‌شود:
 *  ۱) فروشگاه آن را **رندر** می‌کند (چیدمان خوانا با تیتر و فهرست)؛
 *  ۲) API از روی همین داده، صفحهٔ CMS **می‌سازد** (تبدیل وفادانه).
 *
 * اگر محتوا فقط رشتهٔ درون‌خطی در فایل TSX بود، تبدیلِ صفحه به CMS نیاز به
 * یک کپیِ دوم از متن داشت — و آن‌وقت «تبدیل وفادانه» یعنی «کپیِ تقریبی».
 */

/** یک تکه از متن: واژهٔ ساده، پیوند، یا واژهٔ برجسته */
export interface SiteContentSegment {
  /** خودِ متن */
  text: string;
  /** نشانی پیوند (شمارهٔ تماس، ایمیل، اینستاگرام، مسیر داخلی) */
  href?: string;
  /** پیوند بیرونی — در تب تازه باز می‌شود */
  external?: boolean;
  /** واژهٔ برجسته (مثل «راهنمای سایز») */
  strong?: boolean;
  /** چیدمان چپ‌به‌راست (شمارهٔ تماس) */
  ltr?: boolean;
  /** متن کوچک و کم‌رنگ (مثل ساعت کاری) */
  muted?: boolean;
}

/** یک بند — یا متن ساده، یا دنباله‌ای از تکه‌ها */
export type SiteContentParagraph = string | SiteContentSegment[];

/** بند متنی */
export interface SiteContentParagraphBlock {
  kind: "paragraph";
  text: SiteContentParagraph;
}

/** بند یادداشت — کادر کم‌رنگ (مثل یادآوریِ بازگشت کالا) */
export interface SiteContentNoteBlock {
  kind: "note";
  text: SiteContentParagraph;
}

/** بند فهرست */
export interface SiteContentListBlock {
  kind: "list";
  items: SiteContentParagraph[];
}

/** هر بندی که یک صفحهٔ محتوایی می‌تواند داشته باشد */
export type SiteContentBlock =
  | SiteContentParagraphBlock
  | SiteContentNoteBlock
  | SiteContentListBlock;

/** یک بخش — تیتر + چند بند */
export interface SiteContentSection {
  title?: string;
  blocks: SiteContentBlock[];
}

/** یک صفحهٔ محتوایی/قانونی */
export interface SiteContentPage {
  /** نشانی صفحه در سایت — همان کلیدِ سطرِ CMS */
  slug: string;
  /** پاراگرافِ معرفی زیر تیتر اصلی */
  intro?: string;
  /** «آخرین به‌روزرسانی» */
  updated?: string;
  sections: SiteContentSection[];
}

/** تکه‌های یک بند — متن ساده به یک تکه تبدیل می‌شود */
export function segmentsOf(paragraph: SiteContentParagraph): SiteContentSegment[] {
  return typeof paragraph === "string" ? [{ text: paragraph }] : paragraph;
}

/** متنِ خامِ یک بند (بدون نشانه‌گذاری) */
export function paragraphText(paragraph: SiteContentParagraph): string {
  return segmentsOf(paragraph)
    .map((s) => s.text)
    .join("");
}
