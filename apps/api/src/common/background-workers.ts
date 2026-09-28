/**
 * فاز ۱۲ (گام ۵) — گیت workerهای پس‌زمینه.
 *
 * GHASEDAK_WORKERS=off ⇒ تایمرهای EventBus/Reminder/NotificationDispatcher
 * در onModuleInit استارت نمی‌شوند. کاربردها:
 *  - بوت فقط-خواندنی برای smoke/gate (هیچ dispatch/reminder خودکار)
 *  - جداسازی عملیاتی: API روی یک instance با workers=off و یک instance worker-only
 *    (همان کدبیس — بدون سیستم scheduler جدید؛ Existing Capability First)
 * پیش‌فرض (unset یا هر مقدار دیگر): رفتار فعلی — تایمرها روشن.
 */
export function backgroundWorkersEnabled(): boolean {
  return process.env.GHASEDAK_WORKERS?.toLowerCase() !== "off";
}
