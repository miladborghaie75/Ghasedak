import { BRANCHES, site } from "../site-info";
import { SHARED_COPY } from "../site-copy";
import type { SiteContentPage } from "./types";

/**
 * محتوای «دربارهٔ ما» — همین متن هم در سایت رندر می‌شود و هم مبنای
 * ساختِ صفحهٔ CMS توسط صفحه‌ساز است.
 *
 * لحن: خودمانی (مخاطب: «تو») — همان چیزی که در نسخهٔ قبلی سایت بود.
 */
export const ABOUT_CONTENT: SiteContentPage = {
  slug: "about",
  intro:
    "لباس زیر قاصدک یک فروشگاه تخصصی لباس زیر است؛ برای جایی که انتخاب سایز درست نباید کابوس باشد.",
  sections: [
    {
      title: "فلسفه ما",
      blocks: [
        {
          kind: "paragraph",
          text: "خرید لباس زیر معمولاً با سه نگرانی همراه است: سایزم را نمی‌دانم، جنس پارچه را نمی‌شناسم، و بسته‌بندی محترمانه است یا نه. ما فروشگاه را طوری ساخته‌ایم که هر سه نگرانی پاسخ روشن داشته باشد.",
        },
        {
          kind: "paragraph",
          text: "به همین دلیل کنار هر محصول، راهنمای سایز و جدول اندازه وجود دارد؛ جنس پارچه شفاف نوشته شده؛ و همه بسته‌ها محترمانه و بدون نمایش محصول بسته‌بندی می‌شوند.",
        },
      ],
    },
    {
      title: "سه شعبه، یک قیمت",
      blocks: [
        {
          kind: "paragraph",
          text: "می‌توانی آنلاین سفارش بدهی و کالا را از نزدیک‌ترین شعبه تحویل بگیری. قیمت‌ها در فروشگاه اینترنتی و در شعب یکسان است.",
        },
        {
          kind: "list",
          items: BRANCHES.map((b) => [
            { text: `${b.title}:`, strong: true },
            { text: ` ${b.address}` },
          ]),
        },
      ],
    },
    {
      title: SHARED_COPY.sizeGuide,
      blocks: [
        {
          kind: "paragraph",
          text: [
            { text: "اگر بین دو سایز مردد هستی، از ابزار " },
            { text: SHARED_COPY.sizeGuide, strong: true },
            { text: " در سایت استفاده کن؛ اندازه‌هایت را می‌پرسد و سایز نزدیک را پیشنهاد می‌دهد. اگر باز هم مطمئن نشدی، پیش از خرید از ما بپرس." },
          ],
        },
      ],
    },
    {
      title: "ارتباط با ما",
      blocks: [
        {
          kind: "paragraph",
          text: [
            { text: "اگر سؤالی داری، با شماره " },
            { text: site.phoneDisplay, href: site.phoneHref, ltr: true, strong: true },
            { text: " تماس بگیر یا در اینستاگرام ما را دنبال کن: " },
            {
              text: `@${site.instagramHandle}`,
              href: site.instagram,
              external: true,
              ltr: true,
              strong: true,
            },
          ],
        },
      ],
    },
  ],
};
