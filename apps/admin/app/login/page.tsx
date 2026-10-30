import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/session.server";
import { entryNotice, loginFailureCode, postUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

async function loginAction(formData: FormData): Promise<void> {
  "use server";
  const { cookies, headers } = await import("next/headers");
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  // nginx مقدار واقعی را آخر XFF اضافه می‌کند؛ اولین ورودی قابل جعل است.
  const h = await headers();
  const clientIp = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .at(-1);
  // کوکی session را از پاسخ API به مرورگر منتقل می‌کنیم (Server Action → fetch مطلق)
  const result = await postUpstream("/api/v1/auth/login", { email, password }, 8000, clientIp);
  if (!result.ok) {
    // ۴۰۱ یعنی رمز/ایمیل غلط؛ هر خطای دیگر (API خاموش، ۵۰۰) پیام جدا دارد —
    // قبلاً هر دو به «ایمیل یا رمز نادرست» یا مرز خطا تبدیل می‌شدند.
    redirect(`/login?error=${loginFailureCode(result.reason)}`);
  }
  const token = /ghasedak_admin_session=([^;]+)/.exec(result.setCookie ?? "")?.[1];
  // پاسخ سالم ولی بدون کوکی: بی‌کوکی وارد شدن یعنی حلقهٔ «ورود → بازگشت به ورود»
  if (!token) redirect("/login?error=server");
  const jar = await cookies();
  jar.set("ghasedak_admin_session", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  redirect("/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  const me = await getIdentity();
  if (me) redirect("/");
  const { error, notice } = await searchParams;
  const banner = entryNotice(error) ?? entryNotice(notice);
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <form action={loginAction} className="w-full max-w-sm rounded-3xl border border-line bg-surface p-8">
        <div className="mb-6 text-center">
          <div className="text-xl font-bold text-deep">پنل مدیریت قاصدک</div>
          <div className="mt-1 text-xs text-muted">ورود با ایمیل و رمز عبور</div>
        </div>
        {banner ? (
          <div
            role={banner.tone === "ok" ? "status" : "alert"}
            className={
              banner.tone === "ok"
                ? "mb-4 rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok"
                : "mb-4 rounded-xl bg-err/10 px-3 py-2 text-sm text-err"
            }
          >
            {banner.text}
            {error === "down" && process.env.NODE_ENV !== "production" ? (
              <p className="mt-1 text-[11px] text-muted">
                محلی: <span dir="ltr">bash infrastructure/run-local.sh start</span> — و{" "}
                <span dir="ltr">status</span> برای دیدن اینکه کدام سرویس خاموش است.
              </p>
            ) : null}
          </div>
        ) : null}
        <label className="mb-1 block text-sm text-ink" htmlFor="email">
          ایمیل
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          dir="ltr"
          className="mb-4 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong"
        />
        <label className="mb-1 block text-sm text-ink" htmlFor="password">
          رمز عبور
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          dir="ltr"
          className="mb-6 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong"
        />
        <button
          type="submit"
          className="h-11 w-full rounded-xl bg-primary text-on-accent transition-colors hover:bg-primary-strong"
        >
          ورود
        </button>
        <a href="/forgot-password" className="mt-3 block text-center text-xs text-muted hover:underline">
          رمز عبورت را فراموش کرده‌ای؟
        </a>
        {/* گام F0-7: راهنمای حساب DEMO فقط برای توسعه است — در تولید این بلوک در HTML هم رندر نمی‌شود */}
        {process.env.NODE_ENV !== "production" ? (
          <p className="mt-4 rounded-xl bg-primary-soft px-3 py-2 text-[11px] leading-5 text-deep">
            حساب‌های توسعه (DEMO): <span dir="ltr">admin@ghasedak.demo</span> · رمز:{" "}
            <span dir="ltr">Ghasedak#Demo1</span>
          </p>
        ) : null}
      </form>
    </div>
  );
}
