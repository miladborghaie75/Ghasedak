/**
 * مرز «روز» برای شمارش‌های روزانهٔ فروشگاه: تقویم تهران (UTC+3:30، بدون ساعت تابستانی).
 * خروجی، لحظهٔ نیمه‌شب تهران به‌صورت UTC است تا مستقیماً در ستون day Prisma ذخیره شود.
 */
export function tehranDayStart(now: Date = new Date()): Date {
  const isoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // YYYY-MM-DD در تقویم تهران
  const [year, month, day] = isoDate.split("-").map(Number);
  const TEHRAN_OFFSET_MINUTES = 210; // +3:30 ثابت
  return new Date(Date.UTC(year, month - 1, day) - TEHRAN_OFFSET_MINUTES * 60_000);
}
