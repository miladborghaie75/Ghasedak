/**
 * مرز لحن پنل ادمین — پیکربندی محلی روی هستهٔ مشترک `@ghasedak/copy-rules`.
 *
 * همهٔ قواعد تشخیص (R1–R7) و موتور استخراج متن در پکیج مشترک است تا فروشگاه
 * و پنل ادمین از یک حقیقت واحد سنجیده شوند.
 *
 * معماری لحن ادمین (مثل فروشگاه، ۸۰/۲۰):
 *   • پیش‌فرض = «تو» — لحن صمیمی و کاربردی برای اپراتورها: فرم‌ها، جدول‌ها،
 *     گزارش‌ها، خطاها، حالت‌های خالی، تأییدها. متن‌های جدولی که خطاب ندارند
 *     (مثل «بدهکار»، «تاریخ») از اساس خنثی می‌مانند و قاعده‌ای به آنها نمی‌خورد.
 *   • استثنا = «شما» — فهرست زیر. معیار عضویت: اپراتور در آن فایل تعهد، شرط یا
 *     سیاست می‌خواند. فعلاً چنین صفحه‌ای در ادمین نیست؛ فهرست خالی است تا
 *     لازم‌شدنش با دلیل پر شود، نه با سلیقه.
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
 * فایل‌های رسمی ادمین — فعلاً خالی (۲۰٪ استثنا اینجا هنوز صفحه‌ای ندارد).
 * معیار اضافه‌کردن: اپراتور در آن فایل تعهد/شرط/سیاست می‌خواند.
 */
export const FORMAL_FILES = [];

/** دلیل استثنا — در گزارش تست و سند ممیزی خوانده می‌شود. */
export const FORMAL_REASON = "متن تعهدی/سیاستی: اپراتور شرط و التزام می‌خواند";

/**
 * متن‌هایی که باید در کل پنل فقط یک منبع داشته باشند (R6).
 * افزودن هر متن تازه = افزودن به این فهرست + ساخت ثابت مشترک در `lib/copy.ts`.
 */
export const SHARED_STRINGS = [];

/** آیا این فایل حق دارد رسمی باشد؟ */
export function isFormalFile(relPath) {
  return isFormalFileWith(relPath, FORMAL_FILES);
}
