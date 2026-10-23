/**
 * فهرست مرجع صفحات واقعی سایت.
 *
 * چرا این فایل لازم شد؟ صفحه‌ساز تا پیش از این فقط صفحه‌هایی را می‌دید که
 * در جدول `CmsPage` ساخته شده بودند — یعنی «همهٔ مسیرهای واقعی سایت» دیده
 * نمی‌شد و مدیر نمی‌دانست کدام مسیر اصلاً قابل ویرایش است.
 *
 * اینجا یک **منبع حقیقت مشترک** است: هم API از آن استفاده می‌کند تا
 * «صفحات سایت» را برگرداند، هم پنل ادمین برای نشان‌دادن وضعیت هر مسیر.
 * چون هر دو از یک لیست می‌خوانند، وضعیت پنل هرگز با واقعیت سایت اختلاف
 * پیدا نمی‌کند.
 *
 * مسیرهای «داده‌ای» (`/p/*`, `/c/*`, `/guides/*`) عمداً فقط‌خواندنی‌اند:
 * محتوایشان از کاتالوگ و راهنماها می‌آید، نه از صفحه‌ساز.
 */
import { LEGAL_PAGE_TITLES } from "./site-copy";

/** نوع مسیر از نظر اینکه محتوایش از کجا می‌آید */
export type SitePageKind =
  /** محتوای ثابت در کد (پیش‌فرض) که صفحه‌ساز می‌تواند جایگزینش کند */
  | "STATIC"
  /** صفحه‌ای که فقط در صفحه‌ساز وجود دارد (لندینگ سفارشی) */
  | "CMS"
  /** محتوا از دادهٔ کاتالوگ/راهنما می‌آید — فقط‌خواندنی */
  | "DATA"
  /** مسیرهای جریان کاربر (سبد، تسویه، حساب) — فقط‌خواندنی */
  | "FLOW";

export interface SitePageDef {
  /** مسیر واقعی در سایت — همان چیزی که در آدرس‌بار می‌بینید */
  path: string;
  /**
   * شناسهٔ صفحه در CMS.
   * برای مسیرهای قابل‌ویرایش یک slug معتبر؛ برای بقیه `null`.
   */
  slug: string | null;
  /** عنوان فارسی برای پنل */
  title: string;
  kind: SitePageKind;
  /** آیا صفحه‌ساز می‌تواند محتوای این مسیر را عوض کند؟ */
  editable: boolean;
  /** توضیح کوتاه برای پنل */
  note?: string;
}

/**
 * مسیرهای ثابت قابل‌ویرایش.
 *
 * `slug` این مسیرها دقیقاً همان چیزی است که در `CmsPage` ذخیره می‌شود؛
 * پس با ساختن/انتشار صفحه‌ای با همین slug، محتوای همان مسیر سایت عوض
 * می‌شود (بند «صفحهٔ واقعی» در گام ۱۷-۲).
 */
const EDITABLE_PAGES: SitePageDef[] = [
  {
    path: "/",
    slug: "home",
    title: "صفحهٔ اصلی",
    kind: "STATIC",
    editable: true,
    note: "چیدمان پیش‌فرض خانه در کد است؛ با انتشار صفحه جایگزین می‌شود.",
  },
  {
    path: "/about",
    slug: "about",
    // عنوان از برچسبِ مشترک می‌آید — پنل، فوتر و `h1` سایت یک متن را ببینند
    title: LEGAL_PAGE_TITLES.about,
    kind: "STATIC",
    editable: true,
    note: "متن ثابت دربارهٔ فروشگاه.",
  },
  {
    path: "/contact",
    slug: "contact",
    title: LEGAL_PAGE_TITLES.contact,
    kind: "STATIC",
    editable: true,
    note: "راه‌های ارتباطی و فرم تماس.",
  },
  {
    path: "/returns",
    slug: "returns",
    title: LEGAL_PAGE_TITLES.returns,
    kind: "STATIC",
    editable: true,
    note: "شرایط مرجوعی — صفحهٔ حقوقی.",
  },
  {
    path: "/shipping",
    slug: "shipping",
    title: LEGAL_PAGE_TITLES.shipping,
    kind: "STATIC",
    editable: true,
    note: "روش‌ها و زمان‌بندی ارسال.",
  },
  {
    path: "/privacy",
    slug: "privacy",
    title: LEGAL_PAGE_TITLES.privacy,
    kind: "STATIC",
    editable: true,
    note: "سیاست حریم خصوصی — صفحهٔ حقوقی.",
  },
  {
    path: "/terms",
    slug: "terms",
    title: LEGAL_PAGE_TITLES.terms,
    kind: "STATIC",
    editable: true,
    note: "شرایط استفاده از فروشگاه — صفحهٔ حقوقی.",
  },
];

/** مسیرهای داده‌ای و جریان کاربر — فقط‌خواندنی */
const READONLY_PAGES: SitePageDef[] = [
  { path: "/p/*", slug: null, title: "صفحهٔ محصول", kind: "DATA", editable: false, note: "از دادهٔ کاتالوگ می‌آید." },
  { path: "/c/*", slug: null, title: "صفحهٔ دسته‌بندی", kind: "DATA", editable: false, note: "از دادهٔ کاتالوگ می‌آید." },
  { path: "/guides/*", slug: null, title: "راهنماها", kind: "DATA", editable: false, note: "محتوای راهنما از فایل‌های فروشگاه می‌آید." },
  { path: "/search", slug: null, title: "جست‌وجو", kind: "FLOW", editable: false },
  { path: "/cart", slug: null, title: "سبد خرید", kind: "FLOW", editable: false },
  { path: "/checkout/*", slug: null, title: "تسویهٔ حساب", kind: "FLOW", editable: false },
  { path: "/account/*", slug: null, title: "حساب کاربری", kind: "FLOW", editable: false },
  { path: "/order/*", slug: null, title: "پیگیری سفارش", kind: "FLOW", editable: false },
  { path: "/need", slug: null, title: "راهنمای خرید (ویزارد)", kind: "FLOW", editable: false },
  { path: "/need/result", slug: null, title: "نتیجهٔ راهنمای خرید", kind: "FLOW", editable: false },
  { path: "/wishlist", slug: null, title: "علاقه‌مندی‌ها", kind: "FLOW", editable: false },
  { path: "/track", slug: null, title: "پیگیری سفارش", kind: "FLOW", editable: false },
];

/** همهٔ مسیرهای شناخته‌شدهٔ سایت */
export const SITE_PAGES: SitePageDef[] = [...EDITABLE_PAGES, ...READONLY_PAGES];

/** مسیرهایی که صفحه‌ساز می‌تواند محتوایشان را عوض کند */
export const SITE_EDITABLE_PAGES: SitePageDef[] = SITE_PAGES.filter((p) => p.editable);

/** پیدا کردن تعریف مسیر از روی slug صفحهٔ CMS */
export function sitePageBySlug(slug: string): SitePageDef | undefined {
  return SITE_PAGES.find((p) => p.slug === slug);
}

/** مسیر عمومی یک slug در CMS (خانه = «/»، بقیه = «/slug») */
export function sitePathForSlug(slug: string): string {
  return slug === "home" ? "/" : `/${slug}`;
}
