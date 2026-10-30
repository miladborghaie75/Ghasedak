import { redirect } from "next/navigation";
import { notFound } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

const ORDER_STATE: Record<string, { label: string; tone: string }> = {
  PENDING: { label: "در انتظار پرداخت", tone: "bg-amber-100 text-amber-800" },
  PAID: { label: "پرداخت شد", tone: "bg-primary-tint text-primary-strong" },
  PROCESSING: { label: "در حال آماده‌سازی", tone: "bg-primary-tint text-primary-strong" },
  PACKED: { label: "بسته‌بندی شد", tone: "bg-primary-tint text-primary-strong" },
  SHIPPED: { label: "ارسال شد", tone: "bg-sky-100 text-sky-800" },
  DELIVERED: { label: "تحویل شد", tone: "bg-emerald-100 text-emerald-800" },
  CANCELLED: { label: "لغو شد", tone: "bg-app-error/10 text-app-error" },
  PARTIALLY_RETURNED: { label: "بازگشت جزئی", tone: "bg-app-error/10 text-app-error" },
  REFUNDED: { label: "مسترد شد", tone: "bg-app-error/10 text-app-error" },
  FAILED: { label: "ناموفق", tone: "bg-app-error/10 text-app-error" },
};

const faMoney = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
const faDate = (iso: string) =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
const faDateOnly = (iso: string) =>
  new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" }).format(new Date(iso));

async function api<T>(path: string, cookie: string): Promise<T | null> {
  const res = await fetch(`${API}/api/v1${path}`, {
    headers: { cookie },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res || !res.ok) return null;
  return (await res.json().catch(() => null)) as T | null;
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const jar = await cookies();
  const session = jar.get("ghasedak_admin_session")?.value;
  if (!session) redirect(`/account/login?next=/account/orders/${code}`);
  const cookieHeader = `ghasedak_admin_session=${session}`;

  const order = await api<{
    code: string;
    status: string;
    paymentStatus: string;
    total: number;
    subtotal: number;
    shippingCost: number;
    discount: number;
    createdAt: string;
    updatedAt: string;
    items: Array<{
      id: string;
      title: string;
      sku: string;
      qty: number;
      unitPrice: number;
      lineTotal: number;
      variantId: string | null;
      productId: string | null;
    }>;
    address: {
      line: string;
      postalCode: string;
      plaque: string | null;
      unit: string | null;
      province: string;
      city: string;
    } | null;
    payment: {
      provider: string;
      refId: string | null;
      amount: number;
      status: string;
      paidAt: string | null;
    } | null;
    shipment: {
      carrier: string | null;
      trackingCode: string | null;
      status: string | null;
      sentAt: string | null;
      deliveredAt: string | null;
    } | null;
  }>(`/account/orders/${encodeURIComponent(code)}`, cookieHeader);

  if (!order) notFound();

  const st = ORDER_STATE[order.status] ?? { label: order.status, tone: "bg-app text-muted" };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <Link
        href="/account"
        className="inline-flex items-center gap-1 text-sm text-muted hover:underline mb-6"
      >
        ← بازگشت به حساب من
      </Link>

      <div className="rounded-card border border-line bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-lg font-bold text-ink" dir="ltr">
              سفارش #{order.code}
            </h1>
            <p className="mt-1 text-sm text-muted">{faDate(order.createdAt)}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-[11px] font-bold ${st.tone}`}>{st.label}</span>
        </div>

        {/* ── آیتم‌ها ── */}
        <section className="mt-6 border-t border-line pt-6">
          <h2 className="font-display text-sm font-bold text-ink">مقتضیات</h2>
          <ul className="mt-3 divide-y divide-line">
            {order.items.map((item) => (
              <li key={item.id} className="py-3 flex flex-wrap gap-3">
                <div className="flex-1 min-w-[150px]">
                  <p className="text-sm font-medium text-ink">{item.title}</p>
                  {item.sku && <p className="text-[11px] text-muted dir-ltr">SKU: {item.sku}</p>}
                </div>
                <div className="flex items-center gap-3 text-sm text-muted">
                  <span className="w-16 text-right">{faMoney(item.qty)} ×</span>
                  <span className="w-28 text-right">{faMoney(item.unitPrice)} تومان</span>
                  <span className="font-bold text-ink w-28 text-right">{faMoney(item.lineTotal)} تومان</span>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-4 space-y-2 text-sm text-muted border-t border-line pt-4">
            <div className="flex justify-between">
              <span>جمع مقتضیات</span>
              <span className="font-medium text-ink">{faMoney(order.subtotal)} تومان</span>
            </div>
            <div className="flex justify-between">
              <span>تخفیف</span>
              <span className="font-medium text-emerald-600">-{faMoney(order.discount)} تومان</span>
            </div>
            <div className="flex justify-between">
              <span>هزینه ارسال</span>
              <span className="font-medium text-ink">{faMoney(order.shippingCost)} تومان</span>
            </div>
            <div className="flex justify-between border-t border-line pt-2">
              <span className="font-bold text-ink">مبلغ قابل پرداخت</span>
              <span className="font-bold text-ink text-lg">{faMoney(order.total)} تومان</span>
            </div>
          </div>
        </section>

        {/* ── آدرس ارسال ── */}
        {order.address && (
          <section className="mt-6 border-t border-line pt-6">
            <h2 className="font-display text-sm font-bold text-ink">آدرس ارسال</h2>
            <address className="mt-2 text-[13px] leading-6 text-muted not-italic">
              <p>{order.address.line}</p>
              {order.address.plaque && <p>پلاک {order.address.plaque}</p>}
              {order.address.unit && <p>واحد {order.address.unit}</p>}
              <p>{order.address.city}، {order.address.province}</p>
              <p dir="ltr">{order.address.postalCode}</p>
            </address>
          </section>
        )}

        {/* ── پرداخت ── */}
        {order.payment && (
          <section className="mt-6 border-t border-line pt-6">
            <h2 className="font-display text-sm font-bold text-ink">پرداخت</h2>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-muted">درگاه</dt>
                <dd className="font-medium text-ink">{order.payment.provider}</dd>
              </div>
              <div>
                <dt className="text-muted">شماره پیگیری</dt>
                <dd className="font-mono text-ink dir-ltr">{order.payment.refId ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">مبلغ</dt>
                <dd className="font-bold text-ink">{faMoney(order.payment.amount)} تومان</dd>
              </div>
              <div>
                <dt className="text-muted">وضعیت</dt>
                <dd className="font-medium text-ink">{order.payment.status}</dd>
              </div>
              {order.payment.paidAt && (
                <div className="sm:col-span-2">
                  <dt className="text-muted">زمان پرداخت</dt>
                  <dd className="font-medium text-ink">{faDate(order.payment.paidAt)}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* ── ارسال ── */}
        {order.shipment && (
          <section className="mt-6 border-t border-line pt-6">
            <h2 className="font-display text-sm font-bold text-ink">ارسال</h2>
            <dl className="mt-2 grid gap-2 sm:grid-cols-2 text-sm">
              <div>
                <dt className="text-muted">پست/بار</dt>
                <dd className="font-medium text-ink">{order.shipment.carrier ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">کد رهگیری</dt>
                <dd className="font-mono text-ink dir-ltr">{order.shipment.trackingCode ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">وضعیت</dt>
                <dd className="font-medium text-ink">{order.shipment.status ?? "—"}</dd>
              </div>
              {order.shipment.sentAt && (
                <div>
                  <dt className="text-muted">تاریخ ارسال</dt>
                  <dd className="font-medium text-ink">{faDateOnly(order.shipment.sentAt)}</dd>
                </div>
              )}
              {order.shipment.deliveredAt && (
                <div>
                  <dt className="text-muted">تاریخ تحویل</dt>
                  <dd className="font-medium text-ink">{faDateOnly(order.shipment.deliveredAt)}</dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {/* ── تاریخچه وضعیت ── */}
        <section className="mt-6 border-t border-line pt-6">
          <h2 className="font-display text-sm font-bold text-ink">تاریخچه وضعیت</h2>
          <p className="mt-2 text-sm text-muted">
            ثبت شده: {faDate(order.createdAt)}
            {order.updatedAt !== order.createdAt && (
              <> · آخرین بروزرسانی: {faDate(order.updatedAt)}</>
            )}
          </p>
        </section>
      </div>
    </div>
  );
}