"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

/**
 * چاپ فاکتور فروش آنلاین (فاز ۴).
 *
 * چرا این صفحه لازم بود: چاپ سند حسابداری و چاپ فاکتور حضوری (POS) هر دو
 * وجود داشتند، ولی **فاکتور فروش سایت** هیچ مسیر چاپی نداشت — یعنی
 * برای پریکردن فاکتور هر سفارش آنلاین مجبور بودید دستی بنویسید.
 *
 * داده از `GET /orders/by-code/:code` می‌آید که برای مشتری هم عمومی است،
 * پس همین قالب با کد سفارش در فروشگاه هم قابل استفاده است.
 */

interface OrderInvoice {
  code: string;
  status: string;
  paymentStatus: string;
  createdAt: string;
  customerName?: string | null;
  customerMobile?: string | null;
  shippingCost?: number | string | null;
  subtotal?: number | string | null;
  discountTotal?: number | string | null;
  grandTotal?: number | string | null;
  trackingCode?: string | null;
  addressSnapshot?: unknown;
  items: Array<{
    titleSnapshot: string;
    qty: number;
    unitPrice: number | string;
    lineTotal: number | string;
    variant?: { sku: string } | null;
  }>;
}

const PAY_FA: Record<string, string> = {
  PENDING: "در انتظار پرداخت",
  PAID: "پرداخت‌شده",
  FAILED: "ناموفق",
  REFUNDED: "بازگشت وجه",
};

const STATUS_FA: Record<string, string> = {
  PENDING: "در انتظار بررسی",
  CONFIRMED: "تأییدشده",
  PROCESSING: "در حال آماده‌سازی",
  PACKED: "بسته‌بندی‌شده",
  SHIPPED: "ارسال‌شده",
  DELIVERED: "تحویل‌شده",
  CANCELED: "لغو‌شده",
};

const num = (v: unknown) => Number(v ?? 0);

export default function InvoicePrintClient({ code }: { code: string }) {
  const { call, loading } = useAdminApi();
  const [order, setOrder] = useState<OrderInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await call<OrderInvoice>(`/orders/by-code/${encodeURIComponent(code)}`);
      if (!alive) return;
      if (r.ok && r.data) setOrder(r.data);
      else setError(r.error?.message ?? "سفارش یافت نشد.");
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (loading && !order) return <p className="p-6 text-sm text-muted">در حال بارگذاری…</p>;
  if (!order) return <p className="p-6 text-sm text-app-err">{error ?? "سفارش یافت نشد."}</p>;

  const subtotal = num(order.subtotal);
  const discount = num(order.discountTotal);
  const shipping = num(order.shippingCost);
  const total = num(order.grandTotal);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => window.print()}
          className="h-10 rounded-full bg-primary px-6 text-xs font-black text-on-accent"
        >
          چاپ / ذخیره PDF
        </button>
        <a
          href={`/orders?code=${order.code}`}
          className="h-10 rounded-full border border-line px-5 text-xs font-bold"
        >
          بازگشت به سفارش‌ها
        </a>
        {order.paymentStatus !== "PAID" && (
          <span className="rounded-full bg-app-warning/10 px-3 py-1.5 text-[11px] font-bold text-app-warning">
            این سفارش پرداخت نشده — فاکتور فروش معتبری نیست
          </span>
        )}
      </div>

      <article className="print-sheet bg-surface p-8 text-ink">
        <header className="mb-6 flex items-start justify-between gap-6 border-b border-line pb-4">
          <div>
            <h1 className="text-xl font-black">فاکتور فروش</h1>
            <p className="mt-1 text-[11px] text-muted">
              شمارهٔ فاکتور: <span dir="ltr" className="font-mono font-bold">{order.code}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              تاریخ: {new Date(order.createdAt).toLocaleString("fa-IR")}
            </p>
            <p className="mt-0.5 text-[11px] text-muted">
              وضعیت: {STATUS_FA[order.status] ?? order.status} · پرداخت:{" "}
              {PAY_FA[order.paymentStatus] ?? order.paymentStatus}
            </p>
          </div>
          <div className="text-end">
            {order.trackingCode ? (
              <>
                <p className="text-[10px] text-muted">کد رهگیری پستی</p>
                <p dir="ltr" className="font-mono text-sm font-black">
                  {order.trackingCode}
                </p>
              </>
            ) : null}
            <div className="stamp-box mt-2" />
            <div className="mt-1 text-[9px] text-muted">مهر و امضا</div>
          </div>
        </header>

        {(order.customerName || order.customerMobile) && (
          <section className="mb-4 text-[11px] leading-6">
            <p>
              <span className="font-bold">مشتری:</span> {order.customerName ?? "—"}
            </p>
            {order.customerMobile && (
              <p>
                <span className="font-bold">تلفن:</span> <span dir="ltr">{order.customerMobile}</span>
              </p>
            )}
          </section>
        )}

        <table className="w-full text-[12px]">
          <thead>
            <tr className="border-y border-line bg-ink/[0.04]">
              <th className="px-2 py-2 text-start">ردیف</th>
              <th className="px-2 py-2 text-start">کالا</th>
              <th className="px-2 py-2 text-start">کد کالا</th>
              <th className="px-2 py-2 text-end">تعداد</th>
              <th className="px-2 py-2 text-end">قیمت واحد</th>
              <th className="px-2 py-2 text-end">جمع</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((it, i) => (
              <tr key={i} className="border-b border-line/50">
                <td className="px-2 py-1.5 tabular-nums">{i + 1}</td>
                <td className="px-2 py-1.5">{it.titleSnapshot}</td>
                <td className="px-2 py-1.5 font-mono text-[10px]" dir="ltr">
                  {it.variant?.sku ?? "—"}
                </td>
                <td className="px-2 py-1.5 text-end tabular-nums">{fa(String(it.qty))}</td>
                <td className="px-2 py-1.5 text-end tabular-nums">{fa(String(it.unitPrice))}</td>
                <td className="px-2 py-1.5 text-end tabular-nums">{fa(String(it.lineTotal))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* جمع‌ها — تخفیف و ارسال جدا، چون در فاز ۲ از فروش تفکیک شدند */}
        <section className="mt-4 ms-auto max-w-xs text-[12px]">
          <div className="flex justify-between py-1">
            <span>جمع کالاها</span>
            <span className="tabular-nums">{fa(subtotal.toString())}</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between py-1">
              <span>تخفیف</span>
              <span className="tabular-nums">− {fa(discount.toString())}</span>
            </div>
          )}
          {shipping > 0 && (
            <div className="flex justify-between py-1">
              <span>هزینهٔ ارسال</span>
              <span className="tabular-nums">{fa(shipping.toString())}</span>
            </div>
          )}
          <div className="mt-1 flex justify-between border-t-2 border-ink py-2 text-sm font-black">
            <span>قابل پرداخت</span>
            <span className="tabular-nums">{fa(total.toString())} تومان</span>
          </div>
        </section>

        <p className="mt-6 text-[10px] leading-5 text-muted">
          بازگشت کالا طبق شرایط فروشگاه و در مهلت مقرر پذیرفته می‌شود. این فاکتور را برای
          پیگیری سفارش نزد خود نگه دارید.
        </p>

        <footer className="mt-8 flex justify-between gap-8 text-[10px] text-muted">
          <div className="flex-1 border-t border-line pt-1">فروشنده</div>
          <div className="flex-1 border-t border-line pt-1">خریدار</div>
        </footer>
      </article>
    </div>
  );
}