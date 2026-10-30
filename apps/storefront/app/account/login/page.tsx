import Link from "next/link";
import { cookies } from "next/headers";
import { loginAction, otpRequestAction, otpVerifyAction } from "../actions";

export const dynamic = "force-dynamic";

/**
 * ورود مشتری — دو راه هم‌زمان: ایمیل+رمز، یا کد پیامکی (OTP).
 *
 * چرا OTP هم همین‌جاست: شمارهٔ موبایل در این مجموعه شناسهٔ اصلی مشتری است
 * (سفارش، کد پیامکی، بازیابی رمز)؛ اما ایمیل+رمز برای کسی که پیامکش کند یا
 * کد نرسد راهِ جایگزین همیشه باز است. فقط نقش CUSTOMER از اینجا وارد می‌شود؛
 * نقش‌های بالاتر مسیر خودشان (/admin/login) را دارند.
 */
const ERRORS: Record<string, string> = {
  required: "همهٔ خانه‌های لازم را پر کن.",
  bad: "ایمیل یا رمز درست نیست.",
  "not-customer": "این حساب مشتری نیست — برای ورود مدیر از /admin/login استفاده کن.",
  RATE_LIMITED: "چند تلاش ناموفق داشتی؛ چند دقیقه بعد دوباره امتحان کن.",
  CODE_INVALID: "کد واردشده درست نیست یا منقضی شده.",
  CODE_EXPIRED: "کد منقضی شده — یک کد تازه بگیر.",
  MOBILE_UNKNOWN: "شماره ثبت نشده — اول ثبت‌نام کن.",
  MOBILE_AMBIGUOUS: "این شماره چند حساب دارد — با رمز وارد شو.",
  API_UNAVAILABLE: "سرویس فروش در دسترس نیست؛ چند لحظه بعد دوباره تلاش کن.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string; next?: string }>;
}) {
  const { error, sent, next } = await searchParams;
  const nextHidden = <input type="hidden" name="next" value={next ?? ""} />;
  // شمارهٔ مقصد کد در کوکی کوتاه‌عمر است تا در تاریخچهٔ مرورگر (URL) نماند
  const jar = await cookies();
  const otpMobile = jar.get("ghasedak_otp_mobile")?.value ?? "";
  const masked = otpMobile ? `${otpMobile.slice(0, 4)}***${otpMobile.slice(-3)}` : "";

  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <form action={loginAction} className="rounded-card border border-line bg-surface p-6">
        <h1 className="font-display text-lg font-bold text-ink">ورود حساب مشتری</h1>
        <p className="mt-1 text-[13px] leading-6 text-muted">
          با ایمیل و رمز، یا با کد پیامکی — هر کدام برایت راحت‌تر است.
        </p>

        {error && !sent ? (
          <div role="alert" className="mt-4 rounded-xl bg-app-error/10 px-3 py-2 text-[13px] leading-6 text-app-error">
            {ERRORS[error] ?? "خطایی پیش آمد؛ دوباره تلاش کن."}
          </div>
        ) : null}

        <label className="mt-4 block text-[13px] font-medium text-ink" htmlFor="email">
          ایمیل
        </label>
        <input
          id="email"
          name="email"
          type="email"
          dir="ltr"
          autoComplete="email"
          className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
          placeholder="name@example.com"
        />

        <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="password">
          رمز عبور
        </label>
        <input
          id="password"
          name="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
        />

        {nextHidden}
        <button
          type="submit"
          className="mt-5 h-11 w-full rounded-full bg-primary text-sm font-bold text-on-accent hover:bg-primary-hover"
        >
          ورود
        </button>

        <div className="mt-3 flex items-center justify-between text-xs text-muted">
          <Link href="/account/forgot" className="hover:underline">
            رُباعبورم؟
          </Link>
          <Link href={next ? `/account/register?next=${encodeURIComponent(next)}` : "/account/register"} className="hover:underline">
            حساب ندارم — ثبت‌نام
          </Link>
        </div>
      </form>

      {/* ── راه دوم: کد پیامکی ── */}
      <form
        action={sent ? otpVerifyAction : otpRequestAction}
        className="mt-4 rounded-card border border-line bg-surface p-6"
      >
        <h2 className="font-display text-base font-bold text-ink">ورود با کد پیامکی</h2>

        {sent ? (
          <div role="status" className="mt-3 rounded-xl bg-primary-tint px-3 py-2 text-[13px] leading-6 text-ink">
            کد پیامک شد برای {masked} (اعتبار ۵ دقیقه). اگر نیامد، دوباره بگیر.
            <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="code">
              کد یک‌بارمصرف
            </label>
            <input
              id="code"
              name="code"
              dir="ltr"
              inputMode="numeric"
              autoComplete="one-time-code"
              className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-center text-base tracking-[0.4em] outline-none focus:border-primary"
              placeholder="––––––"
            />

          </div>
        ) : (
          <>
            <label className="mt-3 block text-[13px] font-medium text-ink" htmlFor="mobile">
              شمارهٔ موبایل
            </label>
            <input
              id="mobile"
              name="mobile"
              dir="ltr"
              inputMode="numeric"
              autoComplete="tel"
              className="mt-1 h-11 w-full rounded-full border border-line bg-app px-4 text-sm outline-none focus:border-primary"
              placeholder="09xxxxxxxxx"
            />
          </>
        )}

        {nextHidden}
        {error && sent ? (
          <div role="alert" className="mt-3 rounded-xl bg-app-error/10 px-3 py-2 text-[13px] text-app-error">
            {ERRORS[error] ?? "کد پذیرفته نشد؛ دوباره تلاش کن."}
          </div>
        ) : null}

        <button
          type="submit"
          className="mt-4 h-11 w-full rounded-full border border-primary text-sm font-bold text-primary hover:bg-primary-tint"
        >
          {sent ? "تایید کد و ورود" : "ارسال کد"}
        </button>
        {sent ? (
          <Link href={`/account/login${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="mt-3 block text-center text-xs text-muted hover:underline">
            شماره یا کد عوض شد — از اول
          </Link>
        ) : null}
      </form>
    </div>
  );
}
