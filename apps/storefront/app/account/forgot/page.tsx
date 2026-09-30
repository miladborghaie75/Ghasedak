import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

async function forgotAction(formData: FormData): Promise<void> {
  "use server";
  const mobile = String(formData.get("mobile") ?? "").replace(/\D/g, "").replace(/^98/, "0");
  const res = await fetch(`${API}/api/v1/auth/password/forgot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose: "customer", identifier: mobile }),
  });
  const data = (await res.json().catch(() => null)) as { devToken?: string } | null;
  const dev = data?.devToken ? `&dev=1&token=${encodeURIComponent(data.devToken)}` : "";
  redirect(`/account/forgot?sent=1${dev}`);
}

export default async function CustomerForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; dev?: string; token?: string; error?: string }>;
}) {
  const { sent, dev, token, error } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <form action={forgotAction} className="rounded-card border border-line bg-surface p-6">
        <h1 className="font-display text-lg font-bold text-ink">بازیابی رمز</h1>
        <p className="mt-1 text-[13px] leading-6 text-muted">شماره موبایل حساب‌تان را وارد کنید؛ کد یک‌بارمصرف پیامک می‌شود.</p>
        {sent ? (
          <div role="status" className="mt-4 rounded-xl bg-primary-tint px-3 py-2 text-[13px] leading-6 text-ink">
            اگر این شماره در سیستم و دارای رمز باشد، کد ارسال شد. (اعتبار: ۳۰ دقیقه)
            {dev && token ? (
              <p className="mt-2 text-[11px] text-muted" dir="ltr">DEV token: <code className="break-all">{token}</code></p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl bg-app-error/10 px-3 py-2 text-[13px] text-app-error">
            شماره معتبر نیست — با ۰۹ و ۱۱ رقم.
          </div>
        ) : null}
        <label className="mt-5 mb-1 block text-[13px] text-ink" htmlFor="mobile">موبایل</label>
        <input id="mobile" name="mobile" inputMode="numeric" required dir="ltr" placeholder="0912…"
          className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong" />
        <button type="submit" className="mt-5 h-11 w-full rounded-full bg-primary text-sm font-bold text-on-accent hover:bg-primary-hover">
          ارسال کد
        </button>
        <a href="/account/reset" className="mt-4 block text-center text-xs text-muted hover:underline">کد را دارم — ثبت رمز جدید</a>
      </form>
    </div>
  );
}
