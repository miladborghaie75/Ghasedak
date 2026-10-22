/**
 * اطلاعات هویتی و تماس فروشگاه — از پکیجِ مشترکِ قراردادها می‌آید.
 *
 * چرا دیگر اینجا نوشته نمی‌شود؟ چون متنِ صفحه‌های ایستا (دربارهٔ ما،
 * تماس، شرایط بازگشت، …) یک منبعِ مشترک در `packages/contracts` دارد و
 * API هم برای تبدیلِ همان متن به صفحهٔ CMS به شمارهٔ تماس و فهرست شعب
 * نیاز دارد. اگر داده اینجا می‌ماند، دو نسخه از آن می‌ساخت.
 *
 * پس این فایل فقط یک دوباره‌صادرکردن است — و همهٔ مصرف‌کننده‌های فعلی
 * (`import { site } from "@/lib/site"`) بدون تغییر کار می‌کنند.
 */

/** دامنه رسمی — در metadataBase، sitemap و robots استفاده می‌شود */
export const SITE_URL = "https://lebaszirghasedak.ir";

export { BRANCHES, RETURN_POLICY, site } from "@ghasedak/contracts";
export type { Branch } from "@ghasedak/contracts";
