/**
 * Money — انتزاع مالی مشترک (بند ۹۷ و تصمیم تاییدشده)
 *
 * قواعد:
 * ۱) همه مبالغ عدد صحیح‌اند؛ Float/Double ممنوع.
 * ۲) واحد عملیاتی فعلی «تومان» است (IRT). کد استاندارد ارز (IRR)
 *    فقط در لایه نمایش/درگاه بانکی استفاده می‌شود و اینجا وجود ندارد.
 * ۳) هیچ تبدیل تومان/ریال پراکنده انجام نمی‌شود — تبدیل بعداً فقط در
 *    لایه مرکزی Gateway/Accounting اضافه خواهد شد.
 * ۴) درصد و ضرب با گردکردن نیم‌به‌بالا روی اعداد صحیح (roundDiv)
 *    انجام می‌شود تا هیچ خطای اعشاری وارد چرخه مالی نشود.
 */

export type CurrencyCode = "IRT";

export const ACTIVE_CURRENCY: CurrencyCode = "IRT";

export interface Money {
  /** مبلغ صحیح — همیشه >= 0 برای مبالغ پرداختی؛ deltas جداگانه مدل می‌شوند */
  amount: number;
  currency: CurrencyCode;
}

/** سازنده Money با اعتبارسنجی صحیح بودن */
export function money(amount: number, currency: CurrencyCode = ACTIVE_CURRENCY): Money {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error(`مبلغ نامعتبر: ${amount}`);
  }
  return { amount, currency };
}

/** تقسیم صحیح با گرد کردن نیم‌به‌بالا — پایه همه محاسبات درصدی */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0) {
    throw new Error(`تقسیم نامعتبر: ${numerator}/${denominator}`);
  }
  return Math.floor(numerator / denominator) + (numerator % denominator !== 0 ? 1 : 0);
}

export function moneyAdd(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function moneySubtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

/** ضرب در عدد صحیح (تعداد) */
export function moneyMultiply(a: Money, qty: number): Money {
  if (!Number.isSafeInteger(qty) || qty < 0) {
    throw new Error(`تعداد نامعتبر: ${qty}`);
  }
  return money(a.amount * qty, a.currency);
}

/** درصد (0..100) با گرد کردن نیم‌به‌بالا */
export function moneyPercent(a: Money, percent: number): Money {
  if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) {
    throw new Error(`درصد نامعتبر: ${percent}`);
  }
  return money(roundDiv(a.amount * percent, 100), a.currency);
}

export function moneyEquals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function moneyIsZero(a: Money): boolean {
  return a.amount === 0;
}

/** سقف (min) دو مبلغ — مثلاً محدودسازی تخفیف با maxDiscount */
export function moneyMin(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return a.amount <= b.amount ? a : b;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new Error(`عدم تطابق واحد پول: ${a.currency} != ${b.currency}`);
  }
}
