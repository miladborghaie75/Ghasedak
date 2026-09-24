import type { Metadata } from "next";
import Link from "next/link";
import { faNum } from "@/lib/format";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: "رسید سفارش",
  robots: { index: false },
};

/**
 * رسید سفارش. در دمو: کد از مسیر خوانده می‌شود و جزئیات از sessionStorage
 * سمت کلاینت می‌آید (OrderClient). با بک‌اند: Order واقعی از DB.
 */
export default async function OrderPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <div className="mx-auto max-w-2xl px-3 py-10 sm:px-4">
      <div className="rounded-blob border border-line bg-surface p-6 text-center shadow-clay-1 sm:p-10">
        <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[#E9F7F0]">
          <svg viewBox="0 0 24 24" className="size-8 text-[#2E9E6B]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h1 className="font-display text-2xl text-plum sm:text-3xl">سفارش شما ثبت شد</h1>
        <p className="mt-2 text-[13px] leading-7 text-muted">
          کد پیگیری سفارش شما:{" "}
          <strong className="font-extrabold text-ink" dir="ltr">{code}</strong>
        </p>
        <p className="mx-auto mt-3 max-w-md rounded-xl bg-primary-tint p-3.5 text-[12px] leading-6 text-muted">
          نسخه نمایشی: جزئیات کامل سفارش در نسخه واقعی پس از اتصال درگاه پرداخت
          و دیتابیس به این صفحه متصل می‌شود.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white shadow-clay-1 hover:bg-primary-press">
            بازگشت به فروشگاه
          </Link>
          <Link href="/search" className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-6 text-sm font-bold text-primary-strong hover:bg-primary-tint">
            ادامه خرید
          </Link>
        </div>
      </div>
    </div>
  );
}
