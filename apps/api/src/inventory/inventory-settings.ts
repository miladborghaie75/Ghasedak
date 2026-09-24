/**
 * تنظیمات انبار — قانون ۶: هیچ مقدار کسب‌وکاری hardcode نمی‌شود؛ هر کلید
 * type + default + validation + description دارد و از DB خوانده می‌شود.
 * این فایل فقط «شکل» تنظیمات است؛ مقدار واقعی همیشه از InventorySetting می‌آید
 * (در نبود ردیف، default همین‌جا اعمال می‌شود).
 */
export interface InventorySettingDef {
  key: string;
  type: "number" | "boolean" | "string";
  default: number | boolean | string;
  min?: number;
  max?: number;
  description: string;
}

export const INVENTORY_SETTINGS: InventorySettingDef[] = [
  {
    key: "reservationTtlMinutes",
    type: "number",
    default: 30,
    min: 1,
    max: 1440,
    description: "مدت اعتبار رزرو خودکار موجودی (دقیقه) — پس از آن رزرو آزاد می‌شود.",
  },
  {
    key: "adjustmentApprovalThreshold",
    type: "number",
    default: 5,
    min: 0,
    max: 100000,
    description: "حداکثر اختلاف مطلق انبارگردانی (عدد) که بدون تایید مدیر ثبت می‌شود؛ بزرگ‌تر نیاز به تایید دارد.",
  },
  {
    key: "deadStockDays",
    type: "number",
    default: 90,
    min: 7,
    max: 730,
    description: "کالایی که در این بازه هیچ خروجی (فروش/انتقال) نداشته باشد Dead Stock گزارش می‌شود.",
  },
  {
    key: "fastMoverDays",
    type: "number",
    default: 30,
    min: 1,
    max: 365,
    description: "پنجره محاسبه گردش و Fast/Slow Mover (روز).",
  },
  {
    key: "lowStockAlerts",
    type: "boolean",
    default: true,
    description: "ارسال هشدار ادمین هنگام رسیدن موجودی به آستانه کم.",
  },
  {
    key: "restockAlerts",
    type: "boolean",
    default: true,
    description: "ارسال SMS «موجود شد» به مشتریان ثبت‌نام‌شده هنگام موجود شدن کالا.",
  },
  {
    key: "minRestockQty",
    type: "number",
    default: 1,
    min: 1,
    max: 1000,
    description: "حداقل موجودی ورودی برای فعال‌شدن نوتیفیکیشن «موجود شد».",
  },
  {
    key: "defaultWarehouseCode",
    type: "string",
    default: "MAIN",
    description: "کد انبار پیش‌فرض برای عملیاتی که انبار مشخص نمی‌کنند.",
  },
  {
    key: "transferRequireConfirm",
    type: "boolean",
    default: true,
    description: "انتقال بین‌انباری پیش از Done باید توسط کاربر دیگر تایید شود.",
  },
  {
    key: "correctionMaxQty",
    type: "number",
    default: 50,
    min: 1,
    max: 100000,
    description: "حداکثر تعداد اصلاح Available در یک حرکت CORRECTION.",
  },
];
