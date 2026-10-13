/**
 * انواع و توابع نشست ادمین.
 *
 * این فایل عمداً **همهٔ بخش سروری** ندارد و هیچ چیزی از `next/headers`
 * وارد نمی‌کند، چون کامپوننت‌های کلاینتی (`Shell`, `MobileNav`) هم
 * `AdminMe` و `can()` را لازم دارند. قبلاً همین یک import باعث می‌شد بیلد
 * ادمین بشکند: «You're importing a component that needs next/headers».
 *
 * توابعی که واقعاً کوکی می‌خوانند در `session.server.ts` هستند.
 */

export interface AdminMe {
  userId: string;
  name?: string;
  email?: string;
  role: string;
  permissions: string[];
}

/** آیا مجوز را دارد؟ `*` یعنی مدیر ارشد و همه‌چیز. */
export function can(permissions: string[], permission: string): boolean {
  if (!permission) return true;
  if (permissions.includes("*")) return true;
  return permissions.includes(permission);
}

/** نقش‌ها به فارسی — استفاده مشترک بین سایدبار و موبایل */
export function roleFa(role: string): string {
  const map: Record<string, string> = {
    SUPER_ADMIN: "مدیر ارشد",
    ACCOUNTANT: "حسابدار",
    STORE_MANAGER: "مدیر فروشگاه",
    CASHIER: "صندوقدار",
    INVENTORY_MANAGER: "مدیر انبار",
    SALES_MANAGER: "مدیر فروش",
    MARKETING_MANAGER: "مدیر بازاریابی",
    SUPPORT: "پشتیبانی",
  };
  return map[role] ?? role;
}
