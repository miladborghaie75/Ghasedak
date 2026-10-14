import type { Metadata } from "next";
import Link from "next/link";
import type { TrackingResult } from "@ghasedak/contracts";
import { faNum } from "@/lib/format";
import { SITE_URL, site } from "@/lib/site";

/** رسید/وضعیت سفارش — بند ۳۷
 *
 * پیش‌تر این صفحه فقط یک رسید نمایشی بود و می‌گفت «نسخه نمایشی». حالا
 * وضعیت واقعی مرسوله را از API می‌خواند تا مشتری بلافاصله بعد از ثبت
 * سفارش بداند کجای مسیر است و پس از تحویل به پست، کد رهگیری را ببیند.
 *
 * همه‌چیز از مسیر `shipping/track/:code` می‌آید که هم کد سفارش را می‌پذیرد
 * هم کد پستی — پس یک منبع حقیقت داریم، نه دو مسیر موازی.
 *
 * گام ۹ (F1-13): همین صفحه سطحِ چاپِ فروشگاه است — فاکتور. اقلام و جمع‌ها از
 * `orders/by-code/:code` می‌آید که عمداً **بدون PII** است (کد سفارش سریالی و
 * حدس‌پذیر است؛ اسم/موبایل/آدرس نمی‌آید). روی کاغذ: کروم سایت با `print:hidden`
 * حذف می‌شود و هویت فروشگاه با بلوک فقط-چاپ می‌آید.
 */

export const metadata: Metadata = {
  title: "رسید سفارش",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/** فاکتور عمومی — همان انتخاب‌های `byCodePublic` در API */
interface PublicOrder {
  code: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  shippingCost: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  createdAt: string;
  items: Array<{
    titleSnapshot: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    variant: { sku: string } | null;
  }>;
}

/** برچسب‌های فارسی وضعیت — همان واژه‌ها در کل رابط کاربری */
const STATUS_FA: Record<string, string> = {
  PENDING: "ثبت شده",
  PAID: "پرداخت شده",
  PROCESSING: "در حال آماده‌سازی",
  PACKED: "بسته‌بندی شده",
  SHIPPED: "ارسال شده",
  DELIVERED: "تحویل داده شده",
  CANCELLED: "لغو شده",
  PARTIALLY_RETURNED: "بازگشت جزئی",
  REFUNDED: "بازگشت داده شده",
  FAILED: "ناموفق",
};

const PAYMENT_FA: Record<string, string> = {
  PENDING: "در انتظار پرداخت",
  AUTHORIZED: "تأیید شده",
  PAID: "پرداخت شده",
  FAILED: "پرداخت ناموفق",
  REFUNDED: "بازگشت داده شده",
};

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

/**
 * اقلام و جمع‌های سفارش برای فاکتور. یک کد ناشناخته `null` می‌دهد (نه صفحهٔ
 * خطا) — رسید باید حتی وقتی فاکتور نمی‌آید، وضعیت مرسوله را نشان دهد.
 */
async function lookupOrder(code: string): Promise<PublicOrder | null> {
  const api = process.env.API_ORIGIN ?? "http://localhost:4000";
  try {
    const r = await fetch(`${api}/api/v1/orders/by-code/${encodeURIComponent(code)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!r.ok) return null;
    const text = await r.text();
    if (!text.trim()) return null;
    const body = JSON.parse(text) as PublicOrder | null;
    return body && Array.isArray(body.items) ? body : null;
  } catch {
    return null;
  }
}

export default async function OrderPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const [tracking, order] = await Promise.all([lookup(code), lookupOrder(code)]);

  const orderLabel = order ? (STATUS_FA[order.status] ?? order.status) : null;
  const paymentLabel = order ? (PAYMENT_FA[order.paymentStatus] ?? order.paymentStatus) : null;
  const showPayment = paymentLabel != null && paymentLabel !== orderLabel;

  return (
    <div className="mx-auto max-w-2xl px-3 py-10 sm:px-4">
      <div className="rounded-blob border border-line bg-surface p-6 text-center shadow-clay-1 sm:p-10">
        <span className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-[#E9F7F0] print:hidden">
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

        <div className="mt-6 flex flex-wrap items-center justify-center gap-3 print:hidden">
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

      {order && (
        /* ── فاکتور سفارش (قابل چاپ) ── */
        <section
          aria-label="فاکتور سفارش"
          className="mt-6 rounded-card border border-line bg-surface p-5 shadow-clay-1"
        >
          {/* هویت روی کاغذ — روی نمایشگر تکراری است و پنهان می‌ماند */}
          <div className="hidden border-b border-line pb-3 print:block">
            <p className="text-sm font-extrabold text-ink">{site.fullName}</p>
            <p className="mt-1 text-[11px] text-muted">
              {site.phoneDisplay} · @{site.instagramHandle} · {site.workingHours}
            </p>
            <p className="mt-0.5 text-[11px] text-muted" dir="ltr">
              {SITE_URL}
            </p>
          </div>

          <header className="flex flex-wrap items-baseline justify-between gap-2 print:mt-3">
            <h2 className="font-display text-lg text-plum">فاکتور سفارش</h2>
            <p className="text-[11px] leading-6 text-muted">
              کد سفارش:{" "}
              <strong className="font-bold text-ink" dir="ltr">
                {order.code}
              </strong>
              {faDate(order.createdAt) && <> · {faDate(order.createdAt)}</>}
            </p>
          </header>

          <p className="mt-2 text-[11px] leading-6 text-muted">
            وضعیت سفارش: <strong className="font-bold text-ink">{STATUS_FA[order.status] ?? order.status}</strong>
            {/* دو برچسب هم‌معنا تکرار نمی‌شوند (مثلاً PAID/PAID → یک بار «پرداخت شده») */}
            {showPayment && <> · پرداخت: <strong className="font-bold text-ink">{paymentLabel}</strong></>}
          </p>

          <table className="mt-4 w-full border-collapse text-[12px]">
            <caption className="sr-only">اقلام سفارش</caption>
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-2 text-start font-bold">کالا</th>
                <th scope="col" className="py-2 text-center font-bold">تعداد</th>
                <th scope="col" className="py-2 text-end font-bold">قیمت</th>
                <th scope="col" className="py-2 text-end font-bold">جمع</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, i) => (
                <tr key={`${it.variant?.sku ?? it.titleSnapshot}-${i}`} className="border-b border-line/60 align-top">
                  <td className="py-2.5 pe-2">
                    <span className="font-bold text-ink">{it.titleSnapshot}</span>
                    {it.variant?.sku && (
                      <span className="mt-0.5 block text-[10px] text-muted" dir="ltr">
                        {it.variant.sku}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 text-center tnum">{faNum(it.qty)}</td>
                  <td className="py-2.5 text-end tnum">{faNum(it.unitPrice)}</td>
                  <td className="py-2.5 text-end font-bold tnum">{faNum(it.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <dl className="mt-3 ms-auto max-w-xs text-[12px]">
            <div className="flex items-center justify-between py-1">
              <dt className="text-muted">جمع کالاها</dt>
              <dd className="tnum">{faNum(order.subtotal)} تومان</dd>
            </div>
            <div className="flex items-center justify-between py-1">
              <dt className="text-muted">هزینه ارسال</dt>
              <dd className="tnum">
                {order.shippingCost === 0 ? "رایگان" : `${faNum(order.shippingCost)} تومان`}
              </dd>
            </div>
            {order.discountTotal > 0 && (
              <div className="flex items-center justify-between py-1">
                <dt className="text-muted">تخفیف</dt>
                <dd className="tnum">−{faNum(order.discountTotal)} تومان</dd>
              </div>
            )}
            {order.taxTotal > 0 && (
              <div className="flex items-center justify-between py-1">
                <dt className="text-muted">مالیات</dt>
                <dd className="tnum">{faNum(order.taxTotal)} تومان</dd>
              </div>
            )}
            <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-[13px]">
              <dt className="font-extrabold text-ink">مبلغ کل</dt>
              <dd className="font-extrabold text-ink tnum">{faNum(order.total)} تومان</dd>
            </div>
          </dl>

          <p className="mt-4 text-[10px] leading-5 text-muted print:mt-3">
            این فاکتور وضعیت سفارش را نشان می‌دهد و سند مالی رسمی نیست؛ برای هر پرسشی با شمارهٔ
            بالا تماس بگیرید.
          </p>
        </section>
      )}
    </div>
  );
}
