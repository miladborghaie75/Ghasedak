/**
 * ویزارد «چی لازم داری؟» (گام ۱۶ / بند ۹+۲۰) — قرارداد مشترک API، seed و فروشگاه.
 *
 * تک‌منبع: همین فایل هم shape پاسخ `GET /need-finder/steps` را تعریف می‌کند، هم
 * دادهٔ fallback ویزارد را نگه می‌دارد (وقتی DB خالی/در دسترس نیست فروشگاه همین را
 * نشان می‌دهد) و هم seed از همین داده سه گام را می‌سازد — تا UI و DB هرگز واگرا نشوند.
 *
 * قواعد منطبق با بند ۲۰: هر گزینه یک `rule` دارد؛ داخل هر بُعد OR، بین گام‌ها AND:
 *  - categories: دسته‌های مرتبط (slug دستهٔ کاتالوگ)
 *  - attributeTerms: جنس‌های ترجیحی — **slug ترم ویژگی** (مثل «پنبه»).
 *    slug پایدار است: اگر ترم حذف و دوباره ساخته شود، id عوض می‌شود ولی slug می‌ماند.
 *    برای سازگاری با دادهٔ قدیمی، id ترم هم پذیرفته می‌شود (فروشگاه هر دو را می‌سنجد).
 *  - priceMax: سقف بودجه (تومان، روی حداقل قیمت مؤثر واریانت)
 *  - why: دلیل انطباق — به کاربر نشان داده می‌شود (بند ۹)
 * rule خالی/null یعنی «همه» — گام را عملاً غیرمحدود می‌کند (مثل «مهم نیست»).
 */

/** قاعدهٔ انطباق یک گزینه — همهٔ فیلدها اختیاری؛ خالی = بدون محدودیت */
export interface NeedRule {
  /** slug دسته‌های کاتالوگ */
  categories?: string[];
  /** slug ترم‌های ویژگی (جنس و …) — یا id ترم برای دادهٔ قدیمی */
  attributeTerms?: string[];
  priceMax?: number;
  why?: string;
}

export interface NeedFinderOptionDTO {
  /** id پایدار — همان اسلاگ عمومی گزینه (در URL نتیجه هم می‌نشیند) */
  id: string;
  label: string;
  icon: string | null;
  rule: NeedRule | null;
}

export interface NeedFinderStepDTO {
  id: string;
  question: string;
  options: NeedFinderOptionDTO[];
}

/**
 * fallback سه‌گامی: موقعیت → اولویت → بودجه.
 * idهای گام ۱ همان اسلاگ‌های عمومی قبلی (everyday/formal/…) هستند تا لینک‌های
 * `/need?start=…` و `/search?need=…` موجود بدون تغییر کار کنند.
 */
export const NEED_FINDER_FALLBACK: NeedFinderStepDTO[] = [
  {
    id: "nfs-situation",
    question: "برای چه موقعیتی می‌خواهی؟",
    options: [
      { id: "everyday", label: "استفاده روزمره", icon: "🌿", rule: { categories: ["bra", "panty", "set"], why: "مدل‌های ساده و راحت برای هر روز" } },
      { id: "formal", label: "زیر لباس مجلسی", icon: "✨", rule: { categories: ["bra", "panty", "set"], why: "فرم صاف بدون برجستگی زیر لباس" } },
      { id: "sport", label: "ورزش", icon: "🏃‍♀️", rule: { categories: ["sport"], why: "پشتیبانی مناسب در حرکت" } },
      { id: "shaping", label: "فرم‌دهی و ایستایی", icon: "💗", rule: { categories: ["shapewear"], why: "فرم‌دهی ملایم و طبیعی" } },
      { id: "comfort", label: "راحتی", icon: "😌", rule: { categories: ["bra", "panty", "sleepwear"], attributeTerms: ["پنبه", "میکروفایبر"], why: "جنس نرم و نفس‌کش" } },
      { id: "gift", label: "هدیه", icon: "🎁", rule: { categories: ["set", "sleepwear"], why: "انتخاب‌های ویژه برای هدیه" } },
    ],
  },
  {
    id: "nfs-priority",
    question: "چه چیزی برایت مهم‌تر است؟",
    options: [
      { id: "priority-comfort", label: "راحتی بیشتر", icon: "💜", rule: { attributeTerms: ["پنبه", "میکروفایبر"] } },
      { id: "priority-look", label: "ظاهر و فرم", icon: "✨", rule: null },
      { id: "priority-cotton", label: "جنس نخی", icon: "🌿", rule: { attributeTerms: ["پنبه"] } },
      { id: "priority-economy", label: "اقتصادی", icon: "🪙", rule: { priceMax: 400_000 } },
      { id: "priority-quality", label: "کیفیت بالاتر", icon: "⭐", rule: { priceMax: 750_000 } },
    ],
  },
  {
    id: "nfs-budget",
    question: "حدود بودجه‌ات چقدر است؟",
    options: [
      { id: "budget-300", label: "تا ۳۰۰ هزار", icon: null, rule: { priceMax: 300_000 } },
      { id: "budget-500", label: "تا ۵۰۰ هزار", icon: null, rule: { priceMax: 500_000 } },
      { id: "budget-open", label: "مهم نیست", icon: null, rule: null },
    ],
  },
];
