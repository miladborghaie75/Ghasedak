/**
 * متن‌هایی که **هم** رابط کاربری و **هم** محتوای صفحه‌های ایستا لازم دارند.
 *
 * نمونه: «راهنمای سایز» هم دکمهٔ ورود به راهنمای سایز است و هم عنوانِ بخشی
 * در صفحهٔ «دربارهٔ ما». اگر این متن در دو جا نوشته شود، یک روز عوض می‌شود
 * و آن‌وقت در یکی از دو جا غلط می‌ماند — پس اینجا یک‌بار نوشته می‌شود و
 * هر دو طرف از همین می‌خوانند.
 */

/** متن‌های مشترک رابط و محتوا */
export const SHARED_COPY = {
  /** راهنمای تعیین سایز — دکمه‌های سایت و عنوان بخش در صفحهٔ «دربارهٔ ما» */
  sizeGuide: "راهنمای سایز",
} as const;

/**
 * عنوانِ فارسی صفحه‌های محتوایی/حقوقی — در نوارِ پیمایشِ همان صفحه‌ها،
 * فوتر و برگهٔ متادیتا استفاده می‌شود.
 *
 * چرا اینجاست و نه در فروشگاه؟ چون پکیج بلوک‌ها (`@ghasedak/blocks`) باید
 * نوارِ پیمایشِ صفحه‌های محتوایی را رندر کند — هم در سایت و هم در بوم
 * صفحه‌ساز — و پکیج نمی‌تواند از `apps/*` چیزی بخواند. پس این برچسب‌ها به
 * خانهٔ مشترک منتقل شدند و فروشگاه از همین‌جا می‌خواند (تک‌منبعی بودنِ متن،
 * قاعدهٔ R6 در `copy-rules.mjs`).
 */
export const LEGAL_PAGE_TITLES = {
  about: "درباره ما",
  returns: "شرایط بازگشت کالا",
  shipping: "روش‌های ارسال",
  terms: "قوانین و مقررات",
  privacy: "حریم خصوصی",
  contact: "تماس با ما",
} as const;

/** برچسب‌های چارچوبِ صفحهٔ محتوایی (بازگشت، مسیر، تاریخ به‌روزرسانی) */
export const CONTENT_PAGE_COPY = {
  backToStore: "بازگشت به فروشگاه",
  breadcrumb: "مسیر صفحه",
  updatedPrefix: "آخرین به‌روزرسانی:",
} as const;

/**
 * نوارِ پیمایشِ صفحه‌های محتوایی — ترتیب همان چیزی است که سایت امروز دارد.
 * خانه در این فهرست نیست چون نوارِ پیمایش فقط برای همنشین‌های محتوایی است.
 */
export const CONTENT_PAGE_NAV: ReadonlyArray<{ slug: string; href: string; title: string }> = [
  { slug: "about", href: "/about", title: LEGAL_PAGE_TITLES.about },
  { slug: "returns", href: "/returns", title: LEGAL_PAGE_TITLES.returns },
  { slug: "shipping", href: "/shipping", title: LEGAL_PAGE_TITLES.shipping },
  { slug: "terms", href: "/terms", title: LEGAL_PAGE_TITLES.terms },
  { slug: "privacy", href: "/privacy", title: LEGAL_PAGE_TITLES.privacy },
  { slug: "contact", href: "/contact", title: LEGAL_PAGE_TITLES.contact },
];
