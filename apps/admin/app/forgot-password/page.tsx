import { redirect } from "next/navigation";
import { entryNotice, postUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

async function forgotAction(formData: FormData): Promise<void> {
  "use server";
  const email = String(formData.get("email") ?? "").trim();
  const res = await postUpstream<{ devToken?: string }>("/api/v1/auth/password/forgot", {
    purpose: "admin",
    identifier: email,
  });
  if (!res.ok) {
    // API خاموش ≠ ورودی غلط — پیام جدا تا کاربر دنبال اشتباه در ایمیلش نگردد
    redirect(res.reason === "unreachable" ? "/forgot-password?error=down" : "/forgot-password?error=server");
  }
  // پاسخ همیشه generic است — پیام یکسان برای حساب موجود/ناموجود (ضد enumeration)
  const dev = res.data?.devToken ? `&dev=1&token=${encodeURIComponent(res.data.devToken)}` : "";
  redirect(`/forgot-password?notice=sent${dev}`);
}

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string; dev?: string; token?: string }>;
}) {
  const { error, notice, dev, token } = await searchParams;
  const banner = entryNotice(error) ?? entryNotice(notice);
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <form action={forgotAction} className="w-full max-w-sm rounded-3xl border border-line bg-surface p-8">
        <div className="mb-6 text-center">
          <div className="text-xl font-bold text-deep">بازیابی رمز پنل</div>
          <div className="mt-1 text-xs text-muted">ایمیل حساب را وارد کن؛ لینک/کد یک‌بارمصرف برایت ارسال می‌شود.</div>
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
            {dev && token ? (
              <p className="mt-2 text-[11px] text-muted" dir="ltr">
                DEV token: <code className="break-all">{token}</code>
              </p>
            ) : null}
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
