import { BRANCHES, RETURN_POLICY, site } from "../site-info";
import type { SiteContentPage } from "./types";

/**
 * محتوای «تماس با ما» — یادداشت بازگشت کالا هم اینجاست تا مدیر و بازدیدکننده
 * یک حقیقت مشترک ببینند.
 *
 * لحن: خودمانی (مخاطب: «تو»).
 */
export const CONTACT_CONTENT: SiteContentPage = {
  slug: "contact",
  intro:
    "پاسخ‌گویی ما در ساعات کاری، همان روز انجام می‌شود. برای پیگیری سفارش، کد سفارش را همراه داشته باش.",
  sections: [
    {
      title: "شماره تماس",
      blocks: [
        {
          kind: "paragraph",
          text: [
            { text: site.phoneDisplay, href: site.phoneHref, ltr: true, strong: true },
            { text: ` (${site.workingHours})`, muted: true },
          ],
        },
        {
          kind: "paragraph",
          text: [
            { text: "ایمیل: " },
            { text: site.email, href: `mailto:${site.email}`, ltr: true },
          ],
        },
      ],
    },
    {
      title: "شعب فروشگاه",
      blocks: [
        {
          kind: "paragraph",
          text: "برای دیدن و پرو کردن لباس‌ها می‌توانی به هر سه شعبه سر بزنی:",
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
      title: "اینستاگرام",
      blocks: [
        {
          kind: "paragraph",
          text: [
            { text: "جدیدترین محصولات و موجودی شعب را در صفحه اینستاگرام ما ببین: " },
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
    {
      title: "پیش از تماس",
      blocks: [
        {
          kind: "list",
          items: [
            [
              { text: "برای پیگیری سفارش، کد آن را از صفحه " },
              { text: "پیگیری سفارش", href: "/order" },
              { text: " بردار." },
            ],
            [
              { text: "شرایط بازگشت کالا در صفحه " },
              { text: "بازگشت کالا", href: "/returns" },
              { text: " آمده است؛ پیش از تماس درباره مرجوعی، آن بخش را بخوان." },
            ],
          ],
        },
      ],
    },
    {
      title: "",
      blocks: [
        {
          kind: "note",
          text: `یادآوری: بازگشت کالا فقط برای کالای سالم، بدون لکه و با مارک کنده‌نشده و در مهلت ${RETURN_POLICY.windowDays} روز امکان‌پذیر است، چون لباس زیر کالای بهداشتی است.`,
        },
      ],
    },
  ],
};
