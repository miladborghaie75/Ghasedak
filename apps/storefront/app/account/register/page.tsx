import Link from "next/link";
import { registerAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * ثبت‌نام مشتری با موبایل + رمز.
 *
 * چرا موبایل اجباری و ایمیل اختیاری: شناسهٔ عملیاتی مشتری (سفارش، پیامک،
 * بازیابی رمز) شمارهٔ موبایل است؛ ایمیل فقط وقتی هست که برای فاکتور لازم
 * شود. رمز سمت سرور با argon2 هش می‌شود — هیچ رمزی اینجا ذخیره نمی‌شود.
 */
const ERRORS: Record<string, string> = {
  required: "شمارهٔ موبایل و رمز لازم است.",
  WEAK_PASSWORD: "رمز باید حداقل ۸ کاراکتر باشد.",
  MOBILE_EXISTS: "این شماره قبلاً ثبت شده — وارد شو.",
  INVALID_MOBILE: "شمارهٔ موبایل معتبر نیست؛ با ۰۹ و ۱۱ رقم وارد کن.",
  API_UNAVAILABLE: "سرویس فروش در دسترس نیست؛ چند لحظه بعد دوباره تلاش کن.",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; msg?: string; next?: string }>;
}) {
  const { error, msg, next } = await searchParams;

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <form action={registerAction} className="rounded-card border border-line bg-surface p-6">
        <h1 className="font-display text-lg font-bold text-ink">ساخت حساب مشتری</h1>
        <p className="mt-1 text-[13px] leading-6 text-muted">
          با شمارهٔ موبایل حساب بساز؛ برای سفارش‌ها و کد تایید همین شماره کافی است.
        </p>

        {error ? (
          <div role="alert" className="mt-4 rounded-xl bg-app-error/10 px-3 py-2 text-[13px] leading-6 text-app-error">
            {msg ?? ERRORS[error] ?? "خطایی پیش آمد؛ دوباره تلاش کن."}
          </div>
        ) : null}

        <label className="mt-4 block text-[13px] font-medium text-ink" htmlFor="mobile">
          شمارهٔ موبایل
        </label>
        <input
          id="mobile"
          name="mobile"
          dir="ltr"
          inputMode="numeric"
          autoComplete="tel"
          required
          className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
          placeholder="09xxxxxxxxx"
        />

        <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="name">
          نام (اختیاری)
        </label>
        <input
          id="name"
          name="name"
          autoComplete="name"
          className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
        />

        <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="email">
          ایمیل (اختیاری — برای فاکتور)
        </label>
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
        />

        <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="password">
          رمز عبور
        </label>
        <input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          required
          minLength={8}
          className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
        />
        <p className="mt-1 text-[11px] leading-5 text-muted">حداقل ۸ کاراکتر</p>

        <input type="hidden" name="next" value={next ?? ""} />
        <button
          type="submit"
          className="mt-5 h-11 w-full rounded-full bg-primary text-sm font-bold text-on-accent hover:bg-primary-hover"
        >
          ساخت حساب و ورود
        </button>

        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <Link href={next ? `/account/login?next=${encodeURIComponent(next)}` : "/account/login"} className="hover:underline">
            حساب دارم — ورود
          </Link>
          <Link href="/account/forgot" className="hover:underline">
            رمز فراموش شد؟
          </Link>
        </div>
      </form>
    </div>
  );
}
