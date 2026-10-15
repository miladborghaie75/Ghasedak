import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

async function forgotAction(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  const res = await fetch(`${api}/api/v1/auth/password/forgot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose: "admin", identifier: email }),
  });
  // پاسخ همیشه generic است — پیام یکسان برای حساب موجود/ناموجود (ضد enumeration)
  const data = (await res.json().catch(() => null)) as { devToken?: string } | null;
  const dev = data?.devToken ? `&dev=1&token=${encodeURIComponent(data.devToken)}` : "";
  redirect(`/forgot-password?sent=1${dev}`);
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string; dev?: string; token?: string }>;
}) {
  const { sent, error, dev, token } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <form action={forgotAction} className="w-full max-w-sm rounded-3xl border border-line bg-surface p-8">
        <div className="mb-6 text-center">
          <div className="text-xl font-bold text-deep">بازیابی رمز پنل</div>
          <div className="mt-1 text-xs text-muted">ایمیل حساب را وارد کن؛ لینک/کد یک‌بارمصرف برایت ارسال می‌شود.</div>
        </div>
        {sent ? (
          <div role="status" className="mb-4 rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok">
            اگر این ایمیل در سیستم باشد، پیام بازیابی ارسال شده است. (اعتبار کد: ۳۰ دقیقه)
            {dev && token ? (
              <p className="mt-2 text-[11px] text-muted" dir="ltr">
                DEV token: <code className="break-all">{token}</code>
              </p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mb-4 rounded-xl bg-err/10 px-3 py-2 text-sm text-err">
            خطا در ارسال — ورودی را بررسی کن یا کمی بعد تلاش کن.
          </div>
        ) : null}
        <label className="mb-1 block text-sm text-ink" htmlFor="email">ایمیل</label>
        <input id="email" name="email" type="email" required dir="ltr"
          className="mb-6 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong" />
        <button type="submit" className="h-11 w-full rounded-xl bg-primary text-on-accent transition-colors hover:bg-primary-strong">
          ارسال پیام بازیابی
        </button>
        <a href="/login" className="mt-4 block text-center text-xs text-muted hover:underline">بازگشت به ورود</a>
      </form>
    </div>
  );
}
