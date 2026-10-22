import { redirect } from "next/navigation";
import { ChannelField } from "./ChannelField";

export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

/**
 * بازیابی رمز مشتری — با انتخاب کانال (گام ۱۴).
 *
 * چرا انتخابگر: تا پیش از این کانال با «نوع کاربر» قطعی بود و مشتری همیشه
 * پیامک می‌گرفت. حالا خودش انتخاب می‌کند؛ و اگر کانال انتخابی دادهٔ مخاطب
 * نداشته باشد، هیچ پیامکی بی‌اطلاع او فرستاده نمی‌شود — پاسخ همان پیام
 * عمومی می‌ماند (ضد افشای وجود حساب) و راهنما زیر فرم می‌گوید چه کند.
 */
async function forgotAction(formData: FormData): Promise<void> {
  "use server";
  const channel = String(formData.get("channel") ?? "sms") === "email" ? "email" : "sms";
  const raw = String(formData.get("identifier") ?? "").trim();
  const identifier = channel === "sms" ? raw.replace(/\D/g, "").replace(/^98/, "0") : raw.toLowerCase();
  if (!identifier) redirect(`/account/forgot?channel=${channel}&error=empty`);
  const res = await fetch(`${API}/api/v1/auth/password/forgot`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ purpose: "customer", identifier, channel }),
  });
  if (!res.ok) {
    // جزئیات خطا عمداً خوانده نمی‌شود: پاسخ عمومی ضد enumeration همان پیام
    // نامعتبر بودن شناسه را روی خود فرم نشان می‌دهد؛ چیزی از وجود حساب لو نمی‌رود.
    redirect(`/account/forgot?channel=${channel}&error=invalid`);
  }
  const data = (await res.json().catch(() => null)) as { devToken?: string } | null;
  const dev = data?.devToken ? `&dev=1&token=${encodeURIComponent(data.devToken)}` : "";
  redirect(`/account/forgot?sent=1&channel=${channel}${dev}`);
}

export default async function CustomerForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; dev?: string; token?: string; error?: string; channel?: string }>;
}) {
  const { sent, dev, token, error, channel } = await searchParams;
  const selected = channel === "email" ? "email" : "sms";
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <form action={forgotAction} className="rounded-card border border-line bg-surface p-6">
        <h1 className="font-display text-lg font-bold text-ink">بازیابی رمز</h1>
        <p className="mt-1 text-[13px] leading-6 text-muted">
          بگو کد بازیابی را چطور برایت بفرستیم، بعد شناسهٔ همان راه را وارد کن.
        </p>

        <ChannelField initial={selected} />

        {sent ? (
          <div role="status" className="mt-4 rounded-xl bg-primary-tint px-3 py-2 text-[13px] leading-6 text-ink">
            اگر این {selected === "email" ? "ایمیل روی حسابی ثبت شده باشد" : "شماره در سیستم و دارای رمز باشد"}، کد ارسال شد.
            (اعتبار: ۳۰ دقیقه)
            {selected === "email" ? (
              <span className="mt-1 block text-[12px] text-muted">
                اگر ایمیل ثبت‌نشده باشد یا ایمیل نباشد، کدی نمی‌آید — همین پیام نشان داده می‌شود تا وجود حساب لو نرود.
              </span>
            ) : null}
            {dev && token ? (
              <p className="mt-2 text-[11px] text-muted" dir="ltr">DEV token: <code className="break-all">{token}</code></p>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-4 rounded-xl bg-app-error/10 px-3 py-2 text-[13px] text-app-error">
            {error === "empty"
              ? "شناسه را وارد کن تا کد برایت بفرستیم."
              : selected === "email"
                ? "ایمیل معتبر نیست — درست را این‌طور بنویس: name@example.com"
                : "شماره معتبر نیست — باید با ۰۹ شروع شود و ۱۱ رقم باشد."}
          </div>
        ) : null}

        <button type="submit" className="mt-5 h-11 w-full rounded-full bg-primary text-sm font-bold text-on-accent hover:bg-primary-hover">
          ارسال کد
        </button>
        <a href="/account/reset" className="mt-4 block text-center text-xs text-muted hover:underline">
          کد را دارم — ثبت رمز جدید
        </a>
      </form>
    </div>
  );
}
