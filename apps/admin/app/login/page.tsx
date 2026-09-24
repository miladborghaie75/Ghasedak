import { redirect } from "next/navigation";
import { getIdentity } from "@/lib/session";

export const dynamic = "force-dynamic";

async function loginAction(formData: FormData): Promise<void> {
  "use server";
  const { cookies } = await import("next/headers");
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  // کوکی session را از پاسخ API به مرورگر منتقل می‌کنیم (Server Action → fetch مطلق):
  const jar = await cookies();
  const auth = await fetch(`${process.env.API_ORIGIN ?? "http://localhost:4000"}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (auth.ok) {
    const raw = auth.headers.get("set-cookie") ?? "";
    const token = /ghasedak_admin_session=([^;]+)/.exec(raw)?.[1];
    if (token) {
      jar.set("ghasedak_admin_session", token, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 12,
      });
    }
    redirect("/");
  }
  redirect("/login?error=1");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const me = await getIdentity();
  if (me) redirect("/");
  const { error } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <form action={loginAction} className="w-full max-w-sm rounded-3xl border border-line bg-surface p-8">
        <div className="mb-6 text-center">
          <div className="text-xl font-bold text-deep">پنل مدیریت قاصدک</div>
          <div className="mt-1 text-xs text-muted">ورود با ایمیل و رمز عبور</div>
        </div>
        {error ? (
          <div role="alert" className="mb-4 rounded-xl bg-err/10 px-3 py-2 text-sm text-err">
            ایمیل یا رمز نادرست است.
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
          className="h-11 w-full rounded-xl bg-primary text-white transition-colors hover:bg-primary-strong"
        >
          ورود
        </button>
        <p className="mt-4 rounded-xl bg-primary-soft px-3 py-2 text-[11px] leading-5 text-deep">
          حساب‌های توسعه (DEMO): <span dir="ltr">admin@ghasedak.demo</span> · رمز:{" "}
          <span dir="ltr">Ghasedak#Demo1</span>
        </p>
      </form>
    </div>
  );
}
