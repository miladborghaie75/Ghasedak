const faDigits = new Intl.NumberFormat("fa-IR");

/** عدد با ارقام فارسی: 749000 → «۷۴۹٬۰۰۰» */
export function faNum(n: number): string {
  return faDigits.format(n);
}

/** قیمت با ارقام فارسی — واحد «تومان» جدا و کم‌رنگ رندر می‌شود */
export function faPrice(n: number): string {
  return faNum(n);
}

/** درصد تخفیف با ارقام فارسی: 25 → «۲۵٪» */
export function faPercent(n: number): string {
  return `${faDigits.format(n)}٪`;
}

const FA_TO_EN: Record<string, string> = {
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** تبدیل ارقام فارسی/عربی به لاتین برای ورودی‌های عددی */
export function toEnDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (d) => FA_TO_EN[d] ?? d);
}

/** نرمال‌سازی متن فارسی برای جستجو: ي→ی، ك→ک، حذف نیم‌فاصله و اعراب */
export function normalizeFa(s: string): string {
  return s
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[\u200C\u200F\u200E]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
