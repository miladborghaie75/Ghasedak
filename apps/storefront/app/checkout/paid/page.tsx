import Link from "next/link";

export const dynamic = "force-dynamic";

/** صفحه موفقیت — بند ۲۹: CTA «پیگیری سفارش» */
export default async function PaidPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; ref?: string }>;
}) {
  const { order, ref } = await searchParams;
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-xl font-black text-app-ok">پرداخت موفق</h1>
      {order ? <p className="mt-2 text-sm text-ink/70">سفارش {order} با موفقیت پرداخت شد.</p> : null}
      {ref ? <p className="mt-1 text-xs text-ink/50">شماره پیگیری: {ref}</p> : null}
      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <Link href={`/order/${order ?? ""}`} className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-on-accent">
          پیگیری سفارش
        </Link>
        <Link href="/" className="inline-flex h-11 items-center rounded-full border border-line px-6 text-sm font-bold text-ink">
          بازگشت به فروشگاه
        </Link>
      </div>
    </div>
  );
}
