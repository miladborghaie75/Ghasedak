import Link from "next/link";

export const dynamic = "force-dynamic";

/**
 * درگاه پرداخت آزمایشی (dev) — بند ۱۱۱: هرگز production نیست.
 * دکمه موفق → callback با Status=OK؛ دکمه ناموفق → Status=NOK.
 */
export default async function MockGatewayPage({
  searchParams,
}: {
  searchParams: Promise<{ authority?: string; amount?: string; order?: string }>;
}) {
  const { authority, amount, order } = await searchParams;
  const cb = `/api/pay/callback?authority=${encodeURIComponent(authority ?? "")}&order=${encodeURIComponent(order ?? "")}`;
  const fa = (n: string) => Number(n).toLocaleString("fa-IR");

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-card border border-line bg-surface p-6 text-center">
        <p className="text-xs font-bold text-amber-600">درگاه آزمایشی — فقط محیط توسعه</p>
        <h1 className="mt-2 text-lg font-black text-ink">پرداخت آزمایشی</h1>
        <p className="mt-3 text-sm text-ink/70">
          مبلغ: <span className="tabular-nums font-black">{fa(amount ?? "0")} تومان</span>
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            href={`${cb}&Status=OK`}
            className="inline-flex h-12 items-center justify-center rounded-full bg-green-600 text-sm font-black text-white"
          >
            پرداخت موفق (تست)
          </Link>
          <Link
            href={`${cb}&Status=NOK`}
            className="inline-flex h-12 items-center justify-center rounded-full border border-line text-sm font-bold text-ink"
          >
            پرداخت ناموفق (تست)
          </Link>
        </div>
      </div>
    </div>
  );
}
