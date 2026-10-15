import type { Metadata } from "next";
import Link from "next/link";
import type { TrackingResult } from "@ghasedak/contracts";
import { faNum } from "@/lib/format";
import { COPY } from "@/lib/copy";

/** رهگیری مرسوله — بند ۳۷
 *
 * این صفحه «محصول» را رهگیری نمی‌کند؛ مرسولهٔ سفارش را. کاربر می‌تواند
 * کد پستی یا کد سفارش را وارد کند — مشتری معمولاً فقط یکی از این دو را
 * روی پیامک یا رسید دارد، پس هر دو پذیرفته می‌شوند.
 *
 * داده از API واقعی می‌آید (فروشگاه هرگز DB را مستقیم نمی‌خواند) و نتیجه
 * همان لحظه رندر می‌شود — بدون نیاز به API جداگانهٔ سبد و… .
 */

export const metadata: Metadata = {
  title: "پیگیری مرسوله",
  description: "کد رهگیری پستی یا کد سفارش را وارد کن تا وضعیت لحظه‌ای مرسوله را ببینی.",
  alternates: { canonical: "/track" },
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

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" ? sp.code.trim() : "";
  const result = code ? await lookup(code) : null;
  const searched = code.length > 0;

  return (
    <div className="mx-auto max-w-2xl px-3 py-8 sm:px-4 sm:py-12">
      <header className="text-center">
        <span className="inline-flex size-14 items-center justify-center rounded-full bg-primary-tint text-primary-strong">
          <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M3 7h13v10H3z" strokeLinejoin="round" />
            <path d="M16 10h3.5L21 13v4h-5z" strokeLinejoin="round" />
            <circle cx="7" cy="18" r="1.6" />
            <circle cx="17.5" cy="18" r="1.6" />
          </svg>
        </span>
        <h1 className="mt-4 font-display text-2xl text-plum sm:text-3xl">پیگیری مرسوله</h1>
        <p className="mx-auto mt-2 max-w-md text-[13px] leading-7 text-muted">
          کد رهگیری پستی یا کد سفارش را وارد کن تا ببینی مرسوله در چه مرحله‌ای است.
        </p>
      </header>

      {/* جست‌وجو */}
      <form action="/track" method="get" className="mt-7 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="track-code" className="sr-only">
          کد رهگیری یا کد سفارش
        </label>
        <input
          id="track-code"
          name="code"
          defaultValue={code}
          dir="ltr"
          autoComplete="off"
          placeholder="کد رهگیری پستی یا کد سفارش"
          className="h-12 flex-1 rounded-full border border-line bg-surface px-5 text-sm text-ink outline-none focus:border-primary-soft"
        />
        <button
          type="submit"
          className="h-12 shrink-0 rounded-full bg-primary px-7 text-sm font-bold text-on-accent shadow-clay-1 transition-colors hover:bg-primary-press"
        >
          پیگیری
        </button>
      </form>

      {/* نتیجه */}
      {searched && !result && (
        <div
          role="alert"
          className="mt-6 rounded-card border border-err/30 bg-err/5 p-5 text-center"
        >
          <p className="text-sm font-bold text-err">مرسوله‌ای با این کد پیدا نشد.</p>
          <p className="mt-1 text-[12px] leading-6 text-muted">
            کد را دوباره بررسی کن. اگر کد را از پیامک گرفته‌ای، همان را وارد کن؛
            اگر هنوز کد رهگیری دریافت نکرده‌ای، می‌توانی با کد سفارش هم پیگیری کنی.
          </p>
        </div>
      )}

      {result && (
        <section className="mt-6 space-y-4" aria-live="polite">
          {/* خلاصه */}
          <div className="rounded-card border border-line bg-surface p-5 shadow-clay-1">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold text-muted">وضعیت فعلی</p>
                <p className="mt-0.5 font-display text-xl text-plum">{result.stateLabel}</p>
              </div>
              <span className="rounded-full bg-primary-tint px-3 py-1.5 text-[11px] font-bold text-primary-strong">
                {result.provider ?? COPY.postalShipping}
              </span>
            </div>

            <p className="mt-3 text-[13px] leading-7 text-muted">{result.hint}</p>

            <dl className="mt-4 grid gap-2 border-t border-line pt-4 text-[12px] sm:grid-cols-2">
              {result.trackingCode && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">کد رهگیری پستی</dt>
                  <dd dir="ltr" className="tnum font-bold text-ink">
                    {result.trackingCode}
                  </dd>
                </div>
              )}
              {result.orderCode && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">کد سفارش</dt>
                  <dd dir="ltr" className="tnum font-bold text-ink">
                    {result.orderCode}
                  </dd>
                </div>
              )}
              {result.itemCount != null && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">تعداد کالا</dt>
                  <dd className="tnum font-bold text-ink">{faNum(result.itemCount)}</dd>
                </div>
              )}
              {result.shippedAt && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">تاریخ ارسال</dt>
                  <dd className="font-bold text-ink">{faDate(result.shippedAt)}</dd>
                </div>
              )}
              {result.deliveredAt && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-muted">تاریخ تحویل</dt>
                  <dd className="font-bold text-ink">{faDate(result.deliveredAt)}</dd>
                </div>
              )}
            </dl>
          </div>

          {/* خط زمانی */}
          <div className="rounded-card border border-line bg-surface p-5 shadow-clay-1">
            <h2 className="font-display text-base text-plum">مسیر مرسوله</h2>
            <ol className="mt-4 space-y-0">
              {result.events.map((e, i) => {
                const done = e.at != null;
                const isLast = i === result.events.length - 1;
                return (
                  <li key={e.state} className="flex gap-3">
                    {/* ستون نشانه */}
                    <div className="flex flex-col items-center">
                      <span
                        className={`flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] ${
                          done
                            ? "border-primary bg-primary text-on-accent"
                            : "border-line bg-surface text-muted"
                        }`}
                      >
                        {done ? "✓" : i + 1}
                      </span>
                      {!isLast && (
                        <span
                          className={`my-0.5 w-0.5 flex-1 ${done ? "bg-primary" : "bg-line"}`}
                          aria-hidden
                        />
                      )}
                    </div>

                    {/* متن */}
                    <div className={`pb-5 ${isLast ? "pb-0" : ""}`}>
                      <p className={`text-[13px] font-bold ${done ? "text-ink" : "text-muted"}`}>
                        {e.label}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-6 text-muted">{e.hint}</p>
                      {e.at && <p className="mt-1 text-[11px] text-muted">{faDate(e.at)}</p>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <p className="text-center text-[12px] text-muted">
            مشکلی در مرسوله داری؟{" "}
            <Link href="/contact" className="font-bold text-primary-strong hover:underline">
              با ما تماس بگیر
            </Link>
          </p>
        </section>
      )}

      {!searched && (
        <p className="mt-6 text-center text-[12px] leading-6 text-muted">
          کد رهگیری روی بسته‌بندی درج شده و پس از تحویل به پست برایت پیامک می‌شود.
        </p>
      )}
    </div>
  );
}