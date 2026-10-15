/**
 * مرز لحن فروشگاه — پیکربندی محلی روی هستهٔ مشترک `@ghasedak/copy-rules`.
 *
 * همهٔ قواعد تشخیص (R1–R7) و موتور استخراج متن در پکیج مشترک است تا فروشگاه
 * و پنل ادمین از یک حقیقت واحد سنجیده شوند. این فایل فقط دو چیزِ مخصوص
 * فروشگاه را تعریف می‌کند:
 *
 * معماری لحن فروشگاه (۸۰/۲۰):
 *   • پیش‌فرض = «تو» — لحن صمیمی و گرم برای همه‌چیز: کشف، سبد، پرداخت، سفارش،
 *     پیگیری، خطاها، حالت‌های خالی، فرم‌ها، ابزارهای سایز/نیاز، پیام‌های API.
 *   • استثنا = «شما» — فقط صفحات تعهدی/حقوقی: جایی که کاربر حق و شرط می‌خواند.
 *
 * راهنمای کامل: `docs/copy-tone-guide.md`
 */
export {
  BARE_PLURAL_VERBS,
  BROKEN_WRITING,
  FAILURE_MARKERS,
  hasFormalTone,
  hasInformalTone,
  hasStringLiteral,
  ID_END_NOUNS,
  INFORMAL_WORDS,
  isPluralVerb,
  INTERNAL_JARGON,
  MESSAGE_MIN_LENGTH,
  normWord,
  PERSIAN,
  PLURAL_PRONOUNS,
  RULE_DETAIL,
  RULE_TITLE,
  words,
} from "@ghasedak/copy-rules";

export { checkCopy, extractCopy } from "@ghasedak/copy-rules";
import { isFormalFile as isFormalFileWith } from "@ghasedak/copy-rules";

/**
 * صفحاتی که لحن رسمی می‌مانند — ۲۰٪ استثنا.
 * دلیل: متن تعهدی/حقوقی است و کاربر آن را به‌عنوان حق و شرط می‌خواند.
 * هر فایل تازه اینجا باید با همان دلیل اضافه شود، نه با سلیقه.
 */
export const FORMAL_FILES = [
  "app/privacy/page.tsx",
  "app/terms/page.tsx",
  "app/returns/page.tsx",
  "app/shipping/page.tsx",
];

/** دلیل استثنا — در گزارش تست و سند ممیزی خوانده می‌شود. */
export const FORMAL_REASON = "متن تعهدی/حقوقی: کاربر حق و شرط می‌خواند";

/**
 * متن‌هایی که باید در کل فروشگاه فقط یک منبع داشته باشند (R6).
 * افزودن هر متن تازه = افزودن به این فهرست + ساخت ثابت مشترک در `lib/copy.ts`.
 */
export const SHARED_STRINGS = [
  // کنش‌ها و تأییدها
  "به سبد اضافه شد 💜",
  "افزودن به سبد",
  "انتخاب سایز و رنگ",
  "تلاش دوباره",
  "بازگشت به فروشگاه",
  "جستجو",
  "مسیر صفحه",
  "راهنمای سایز",
  "راهنمای خرید",
  // وضعیت‌ها
  "ناموجود",
  "رایگان",
  "ارسال پستی",
  // خطاها
  "سرویس سبد در دسترس نیست.",
  "درخواست ناتمام ماند؛ صفحه را دوباره باز کن.",
  "خطای شبکه؛ اتصال اینترنت را بررسی کن و دوباره تلاش کن.",
  // عنوان صفحات حقوقی — همچنین در ناوبری فوتر/LegalShell
  "درباره ما",
  "شرایط بازگشت کالا",
  "روش‌های ارسال",
  "قوانین و مقررات",
  "حریم خصوصی",
  "تماس با ما",
];

/** آیا این فایل حق دارد رسمی باشد؟ */
export function isFormalFile(relPath) {
  return isFormalFileWith(relPath, FORMAL_FILES);
}
