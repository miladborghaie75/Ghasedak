/**
 * قرارداد رهگیری مرسوله (بند ۳۷)
 *
 * سه مصرف‌کنندهٔ این فایل: API (وضعیت مرسوله را می‌نویسد)، ادمین (هنگام
 * تحویل به پست کد رهگیری را وارد می‌کند) و فروشگاه (مشتری پیگیری می‌کند).
 * برچسب‌های فارسی اینجا یک‌بار تعریف می‌شوند تا هر سه جا یک متن نشان دهند —
 * وگرنه وضعیت «در حال ارسال» در سه جا سه جور نوشته می‌شد.
 *
 * نگاشت وضعیت مرسوله به وضعیت سفارش عمداً اینجا نگه داشته شده: مرسوله
 * منبع حقیقتِ حرکت است و سفارش باید از رویش جلو برود، نه برعکس.
 */

/** وضعیت مرسوله — هم‌نام با enum ‏`ShipmentState` در اسکیما */
export const SHIPMENT_STATES = [
  "PENDING",
  "LABEL_CREATED",
  "IN_TRANSIT",
  "DELIVERED",
  "RETURNED_TO_SENDER",
  "FAILED",
] as const;

export type ShipmentState = (typeof SHIPMENT_STATES)[number];

export const SHIPMENT_STATE_FA: Record<ShipmentState, string> = {
  PENDING: "سفارش ثبت شده",
  LABEL_CREATED: "بسته‌بندی شده",
  IN_TRANSIT: "ارسال شده",
  DELIVERED: "تحویل داده شده",
  RETURNED_TO_SENDER: "بازگشت به فرستنده",
  FAILED: "ناموفق",
};

/** توضیح یک‌خطی هر وضعیت — همان چیزی که مشتری باید بفهمد چه شده */
export const SHIPMENT_STATE_HINT: Record<ShipmentState, string> = {
  PENDING: "سفارش شما ثبت شده و در صف پردازش است.",
  LABEL_CREATED: "کالا بسته‌بندی شد و برچسب پستی به آن الصاق شده است.",
  IN_TRANSIT: "مرسوله به پست تحویل داده شد و در مسیر است.",
  DELIVERED: "مرسوله تحویل داده شد. از شما ممنونیم.",
  RETURNED_TO_SENDER: "مرسوله به فرستنده بازگشت. برای اقدام با ما تماس بگیرید.",
  FAILED: "ارسال ناموفق بود. برای بررسی با ما تماس بگیرید.",
};

/**
 * ترتیب «پیشرفت» — مشتری باید بداند مرسوله کجای مسیر است.
 * وضعیت‌های خطی‌اند (بازگشت/ناموفق انتهای مسیر هستند).
 */
export const SHIPMENT_PROGRESS_STATES: ShipmentState[] = [
  "PENDING",
  "LABEL_CREATED",
  "IN_TRANSIT",
  "DELIVERED",
];

/**
 * نگاشت وضعیت مرسوله به وضعیت سفارش.
 * مقصد نهایی وضعیت سفارش است (مثلاً «ارسال شد» یعنی SHIPPED).
 * در تابع پیاده شد تا با تست پوشش داده شود، نه اینکه صرفاً یک ثابت بماند.
 */
export function orderStatusForShipment(state: ShipmentState): string {
  switch (state) {
    case "PENDING":
      return "PROCESSING";
    case "LABEL_CREATED":
      return "PACKED";
    case "IN_TRANSIT":
      return "SHIPPED";
    case "DELIVERED":
      return "DELIVERED";
    case "RETURNED_TO_SENDER":
      return "FAILED";
    case "FAILED":
      return "FAILED";
    default:
      return "PROCESSING";
  }
}

/** وضعیت‌های پایانی — دیگر منتظر چیزی نمی‌مانیم */
export function isTerminalShipment(state: ShipmentState): boolean {
  return state === "DELIVERED" || state === "RETURNED_TO_SENDER" || state === "FAILED";
}

/** نمایش وضعیت برای کاربر؛ اگر وضعیت ناشناخته بود صادقانه «نامشخص» */
export function shipmentStateFa(state: string): string {
  return SHIPMENT_STATE_FA[state as ShipmentState] ?? "نامشخص";
}

export interface TrackingEvent {
  state: ShipmentState;
  label: string;
  hint: string;
  /** چه زمانی؛ اگر نداشته باشیم null یعنی هنوز نرسیده */
  at: string | null;
  /** رویدادی که زمانش را ثبت کرد */
  atLabel: string;
}

/** پاسخ رهگیری عمومی — چیزی که مشتری می‌بیند */
export interface TrackingResult {
  /** کدی که کاربر وارد کرده (یا کد سفارش) */
  query: string;
  found: true;
  trackingCode: string | null;
  provider: string | null;
  state: ShipmentState;
  stateLabel: string;
  hint: string;
  /** شمارهٔ سفارش — برای اطمینان مشتری */
  orderCode: string | null;
  /** جمع کالاها؛ مشتری لازم ندارد جزئیات ببیند */
  itemCount: number | null;
  createdAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  /** خط زمانی مرحله‌به‌مرحله */
  events: TrackingEvent[];
}

/** نام سرویس‌دهندهٔ پستی — نمایش خواناتر برای مشتری */
export const SHIPPING_PROVIDER_FA: Record<string, string> = {
  post: "پست پیشتاز",
  tipax: "تیپاکس",
  post_office: "پست پیشتاز",
  courier: "پیک",
  pickup: "ارسال از شعبه",
  sajha: "سجاد",
  areashita: "آریاشیتا",
};

/** نام خوانای شرکت پستی */
export function providerFa(provider: string | null | undefined): string | null {
  if (!provider) return null;
  return SHIPPING_PROVIDER_FA[provider] ?? provider;
}