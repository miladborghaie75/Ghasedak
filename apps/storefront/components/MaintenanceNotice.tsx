import { site } from "@/lib/site";

/**
 * صفحهٔ اطلاع تعمیر (گام ۱۰) — به‌جای بستن سایت با متن خشک، یک صفحهٔ
 * «مطمئن» نشان می‌دهیم: فروشگاه دموتازه می‌شود و راه تماس واقعی هست.
 * پیام ادمین (اگر نوشته باشد) جایگزین متن پیش‌فرض می‌شود.
 */
export function MaintenanceNotice({
  message,
  until,
}: {
  message?: string;
  until?: string;
}) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <p className="text-5xl" aria-hidden>
        🧺
      </p>
      <h1 className="mt-5 font-display text-2xl text-plum">فروشگاه دموتازه است</h1>
      <p className="mx-auto mt-3 max-w-md text-sm leading-8 text-muted">
        {message?.trim()
          ? message
          : "چند تغییر کوچک پشت صحنه انجام می‌شود و همین‌جا دیر یا زود دوباره باز می‌شویم."}
      </p>
      {until?.trim() ? (
        <p className="mt-2 text-[13px] font-bold text-primary-strong">
          بازگشت: {until}
        </p>
      ) : null}
      <p className="mx-auto mt-4 max-w-md text-[13px] leading-7 text-muted">
        اگر عجله داری، تلفنی هم می‌توانی سفارش بدهی:
      </p>
      <a
        href={site.phoneHref}
        className="mt-3 inline-flex h-11 items-center rounded-full border border-line bg-surface px-6 text-sm font-bold text-primary-strong shadow-clay-1"
      >
        {site.phoneDisplay}
      </a>
      <p className="mt-6 text-xs text-fg/40">{site.workingHours}</p>
    </div>
  );
}
