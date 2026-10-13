import type { Metadata } from "next";
import Link from "next/link";
import type { TrackingResult } from "@ghasedak/contracts";
import { faNum } from "@/lib/format";

/** رسید/وضعیت سفارش — بند ۳۷
 *
 * پیش‌تر این صفحه فقط یک رسید نمایشی بود و می‌گفت «نسخه نمایشی». حالا
 * وضعیت واقعی مرسوله را از API می‌خواند تا مشتری بلافاصله بعد از ثبت
 * سفارش بداند کجای مسیر است و پس از تحویل به پست، کد رهگیری را ببیند.
 *
 * همه‌چیز از مسیر `shipping/track/:code` می‌آید که هم کد سفارش را می‌پذیرد
 * هم کد پستی — پس یک منبع حقیقت داریم، نه دو مسیر موازی.
 */

export const metadata: Metadata = {
  title: "رسید سفارش",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

function faDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Tehran",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

async function lookup(code: string): Promise<TrackingResult | null> {
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const r = await fetch(`${api}/api/v1/shipping/track/${encodeURIComponent(code)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const body = (await r.json()) as TrackingResult & { found: boolean };
    return body.found ? body : null;
  } catch {
    return null;
  }
}

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const tracking = await lookup(code);

  return (
    <div className="mx-auto max-w-2xl px-3 py-10 sm:px-4">
      <div className="rounded-blob border border-line bg-surface p-6 text-center shadow-clay-1 sm:p-10">
        <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[#E9F7F0]">
          <svg
            viewBox="0 0 24 24"
            className="size-8 text-[#2E9E6B]"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden
          >
            <path d="m5 13 4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h1 className="font-display text-2xl text-plum sm:text-3xl">سفارش شما ثبت شد</h1>
        <p className="mt-2 text-[13px] leading-7 text-muted">
          کد پیگیری سفارش شما:{" "}
          <strong className="font-extrabold text-ink" dir="ltr">
            {code}
          </strong>
        </p>

        {tracking ? (
          /* ── وضعیت واقعی مرسوله ── */
          <div className="mt-6 rounded-card border border-line bg-primary-tint/40 p-5 text-start">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-bold text-muted">وضعیت ارسال</span>
              <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-bold text-primary-strong">
                {tracking.provider ?? "ارسال پستی"}
              </span>
            </div>

            <p className="mt-2 font-display text-lg text-plum">{tracking.stateLabel}</p>
            <p className="mt-1 text-[12px] leading-6 text-muted">{tracking.hint}</p>

            {tracking.trackingCode ? (
              <div className="mt-4 rounded-xl border border-line bg-surface p-3.5">
                <p className="text-[11px] font-bold text-muted">کد رهگیری پستی</p>
                <p className="mt-1 text-lg font-black tracking-wider text-ink" dir="ltr">
                  {tracking.trackingCode}
                </p>
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  این کد را نگه دارید؛ با آن می‌توانید مرسوله را از صفحهٔ پیگیری دنبال کنید.
                </p>
              </div>
            ) : (
              <p className="mt-4 rounded-xl border border-dashed border-line bg-surface p-3.5 text-[12px] leading-6 text-muted">
                کد رهگیری پس از تحویل مرسوله به پست ثبت می‌شود و همین‌جا نمایش داده خواهد شد.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
              {tracking.shippedAt && <span>ارسال: {faDate(tracking.shippedAt)}</span>}
              {tracking.deliveredAt && <span>تحویل: {faDate(tracking.deliveredAt)}</span>}
              {tracking.itemCount != null && (
                <span>
                  {faNum(tracking.itemCount)} کالا در این مرسوله
                </span>
              )}
            </div>
          </div>
        ) : (
          <p className="mx-auto mt-3 max-w-md rounded-xl bg-primary-tint p-3.5 text-[12px] leading-6 text-muted">
            مرسوله‌ای هنوز برای این سفارش ثبت نشده است. به‌محض بسته‌بندی و تحویل به پست،
            وضعیت و کد رهگیری همین‌جا نمایش داده می‌شود.
          </p>
        )}

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href={`/track?code=${encodeURIComponent(code)}`}
            className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-6 text-sm font-bold text-primary-strong hover:bg-primary-tint"
          >
            پیگیری مرسوله
          </Link>
          <Link
            href="/"
            className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-on-accent shadow-clay-1 hover:bg-primary-press"
          >
            بازگشت به فروشگاه
          </Link>
          <Link
            href="/search"
            className="inline-flex h-11 items-center rounded-full border border-line bg-surface px-6 text-sm font-bold text-primary-strong hover:bg-primary-tint"
          >
            ادامه خرید
          </Link>
        </div>
      </div>
    </div>
  );
}