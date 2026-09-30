import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

async function resetAction(formData: FormData): Promise<void> {
  "use server";
  const token = String(formData.get("token") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8 || password !== confirm) redirect(`/account/reset?token=${encodeURIComponent(token)}&error=1`);
  const res = await fetch(`${API}/api/v1/auth/password/reset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose: "customer", token, newPassword: password }),
  });
  if (res.ok) redirect("/account/reset?done=1");
  redirect(`/account/reset?token=${encodeURIComponent(token)}&error=1`);
}

export default async function CustomerResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string; done?: string }>;
}) {
  const { token, error, done } = await searchParams;
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <form action={resetAction} className="rounded-card border border-line bg-surface p-6">
        <h1 className="font-display text-lg font-bold text-ink">ثبت رمز جدید</h1>
        {done ? (
          <div role="status" className="mt-4 rounded-xl bg-primary-tint px-3 py-2 text-[13px] leading-6 text-ink">
            رمز جدید ثبت شد. از این پس با همین رمز وارد شوید.
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl bg-app-error/10 px-3 py-2 text-[13px] text-app-error">
            کد نامعتبر/منقضی یا رمزها هم‌خوان نیستند (حداقل ۸ کاراکتر).
          </div>
        ) : null}
        <label className="mt-5 mb-1 block text-[13px] text-ink" htmlFor="token">کد پیامک‌شده</label>
        <input id="token" name="token" required dir="ltr" defaultValue={token ?? ""}
          className="h-11 w-full rounded-xl border border-line bg-bg px-3 font-mono text-xs outline-none focus:border-primary-strong" />
        <label className="mt-4 mb-1 block text-[13px] text-ink" htmlFor="password">رمز جدید</label>
        <input id="password" name="password" type="password" required minLength={8} dir="ltr"
          className="h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong" />
        <label className="mt-4 mb-1 block text-[13px] text-ink" htmlFor="confirm">تکرار رمز جدید</label>
        <input id="confirm" name="confirm" type="password" required minLength={8} dir="ltr"
          className="mb-6 h-11 w-full rounded-xl border border-line bg-bg px-3 text-sm outline-none focus:border-primary-strong" />
        <button type="submit" className="h-11 w-full rounded-full bg-primary text-sm font-bold text-on-accent hover:bg-primary-hover">
          ثبت رمز
        </button>
      </form>
    </div>
  );
}
