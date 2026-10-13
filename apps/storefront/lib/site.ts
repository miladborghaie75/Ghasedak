/**
 * اطلاعات هویتی و تماس فروشگاه — تنها منبع حقیقت برای تماس، شعب و صفحات قانونی.
 * هیچ داده تماس نمایشی در رابط کاربری وجود ندارد.
 */

/** دامنه رسمی — در metadataBase، sitemap و robots استفاده می‌شود */
export const SITE_URL = "https://lebaszirghasedak.ir";

export const site = {
  name: "قاصدک",
  fullName: "لباس زیر قاصدک",
  tagline: "زیرپوش، ساده و مطمئن",
  description:
    "خرید آنلاین سوتین، شورت، ست، گن، لباس ورزشی و لباس خواب با راهنمای سایز، ارسال سریع و ضمانت اصالت.",
  email: "info@lebaszirghasedak.ir",
  /** شماره تماس فروشگاه — در هدر، فوتر و صفحه تماس نمایش داده می‌شود */
  phone: "09365226093",
  phoneDisplay: "۰۹۳۶۵۲۲۶۰۹۳",
  phoneHref: "tel:+989365226093",
  instagram: "https://instagram.com/ghasedak_underwear",
  instagramHandle: "ghasedak_underwear",
  workingHours: "شنبه تا پنجشنبه، ۱۰ تا ۲۰",
} as const;

export interface Branch {
  id: string;
  title: string;
  address: string;
}

export const BRANCHES: Branch[] = [
  { id: "b1", title: "شعبه ۱", address: "عبدالمطلب ۱۵، بین یاس ۲ و ۴" },
  { id: "b2", title: "شعبه ۲", address: "عبدالمطلب ۱۵، بین یاس ۴ و ۶" },
  { id: "b3", title: "شعبه ۳", address: "بین عبدالمطلب ۱۵ و چهارراه عبدالمطلب" },
];

/**
 * سیاست بازگشت کالا — چون لباس زیر کالای بهداشتی است، بازگشت فقط در
 * شرایطی مجاز است که کالا پوشیده نشده باشد. این متن در /returns و
 * CheckoutClient به کاربر نشان داده می‌شود.
 */
export const RETURN_POLICY = {
  windowDays: 7,
  condition: "کالای سالم، بدون لکه و با مارک کنده‌نشده",
  reason:
    "لباس زیر کالای بهداشتی است؛ بنابراین بازگشت تنها در صورتی پذیرفته می‌شود که کالا پوشیده نشده باشد.",
} as const;
