/**
 * برچسب ترم‌های واقعی DB — پرشده از payload کاتالوگ API (سرور و کلاینت هردو).
 * جدول استاتیک ALL_TERMS دادهٔ دمو است؛ محصول واقعی ترم‌های DB (cuid) دارد و
 * بدون این رجیستری، UI شناسهٔ خام نشان می‌داد. globalThis تا HMR سرور هم
 * رجیستری را نگه دارد و در کلاینت همان ماژول مشترک است.
 */
const g = globalThis as typeof globalThis & { __ghTermLabels?: Map<string, string> };

function map(): Map<string, string> {
  return (g.__ghTermLabels ??= new Map());
}

/** ثابت — هر رندر قبلی تمیز می‌شود تا ترم‌های حذف‌شده بمانند */
export function resetTermLabels(): void {
  map().clear();
}

/** افزودن/به‌روزرسانی برچسب یک ترم (id → برچسب فارسی) */
export function putTermLabel(id: string, label: string): void {
  if (id && label) map().set(id, label);
}

/** برچسب شناخته‌شده یا null — تمایز «ناموجود» از «مقدار خالی» برای fallback لایه‌های بالاتر */
export function lookupTermLabel(id: string): string | null {
  if (!id) return null;
  return map().get(id) ?? null;
}
