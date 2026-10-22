import { redirect } from "next/navigation";
import { entryNotice, postUpstream } from "@/lib/upstream";

export const dynamic = "force-dynamic";

async function resetAction(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const back = (code: string) => `/reset-password?token=${encodeURIComponent(token)}&error=${code}`;
  if (password.length < 8 || password !== confirm) redirect(back("invalid"));
  const res = await postUpstream("/api/v1/auth/password/reset", { purpose: "admin", token, newPassword: password });
  if (res.ok) redirect("/login?notice=reset");
  // سرور در دسترس نیست یا ۵۰۰ داده: کد مصرف نشده — پیام نباید بگوید «کد نامعتبر است»
  if (res.reason === "unreachable") redirect(back("down"));
  if (res.status >= 500) redirect(back("server"));
  redirect(back("invalid"));
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;
  const banner = entryNotice(error);
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <form action={resetAction} className="w-full max-w-sm rounded-3xl border border-line bg-surface p-8">
        <div className="mb-6 text-center">
          <div className="text-xl font-bold text-deep">رمز جدید</div>
          <div className="mt-1 text-xs text-muted">کد یک‌بارمصرف پیام‌شده را وارد کن.</div>
        </div>
        {banner ? (
          <div role="alert" className="mb-4 rounded-xl bg-err/10 px-3 py-2 text-sm text-err">
            {banner.text}
          </div>
        ) : null}
        <label className="mb-1 block text-sm text-ink" htmlFor="token">کد بازیابی</label>
        <input id="token" name="token" required dir="ltr" defaultValue={token ?? ""}
          className="mb-4 h-11 w-full rounded-xl border border-line bg-bg px-3 font-mono text-xs outline-none focus:border-primary-strong" />
        <label className="mb-1 block text-sm text-ink" htmlFor="password">رمز جدید (حداقل ۸ کاراکتر)</label>
        <input id="password" name="password" type="password" required minLength={8} dir="ltr"
          className="mb-4 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong" />
        <label className="mb-1 block text-sm text-ink" htmlFor="confirm">تکرار رمز جدید</label>
        <input id="confirm" name="confirm" type="password" required minLength={8} dir="ltr"
          className="mb-6 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong" />
        <button type="submit" className="h-11 w-full rounded-xl bg-primary text-on-accent transition-colors hover:bg-primary-strong">
          ثبت رمز جدید
        </button>
      </form>
    </div>
  );
}
