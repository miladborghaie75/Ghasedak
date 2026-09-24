import Link from "next/link";

export const dynamic = "force-dynamic";

/** صفحه شکست — بند ۳۱: retry + انتخاب روش دیگر؛ سفارش اصلی حفظ می‌شود */
export default async function FailedPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; reason?: string }>;
}) {
  const { order, reason } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-black text-red-600">پرداخت ناموفق</h1>
      <p className="mt-2 text-sm text-ink/70">
        {reason === "verify"
          ? "تایید پرداخت انجام نشد؛ اگر مبلغ کم شده باشد، حداکثر تا ۷۲ ساعت به حساب شما برمی‌گردد."
          : "پرداخت انجام نشد. سفارش شما حفظ شده و می‌توانید دوباره تلاش کنید."}
      </p>
      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        {order ? (
          <Link href={`/checkout/pay?order=${encodeURIComponent(order)}`} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white">
            تلاش دوباره
          </Link>
        ) : null}
        <Link href="/" className="inline-flex h-11 items-center rounded-full border border-line px-6 text-sm font-bold text-ink">
          بازگشت به فروشگاه
        </Link>
      </div>
    </div>
  );
}
