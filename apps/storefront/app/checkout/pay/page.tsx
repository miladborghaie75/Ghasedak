import Link from "next/link";
import { COPY } from "@/lib/copy";
import { PayForm } from "./PayForm";

export const dynamic = "force-dynamic";

const API = process.env.API_ORIGIN ?? "http://localhost:4000";

function fa(n: string | number): string {
  return Number(n).toLocaleString("fa-IR");
}

/** صفحه پرداخت — بند ۱۱/۴۲: خلاصه سفارش + CTA با مبلغ */
export default async function PayPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order: code } = await searchParams;

  if (!code) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm font-bold text-ink">سفارشی برای پرداخت یافت نشد.</p>
        <Link href="/" className="mt-4 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-on-accent">
          {COPY.backToStore}
        </Link>
      </div>
    );
  }

  const res = await fetch(`${API}/api/v1/orders/by-code/${encodeURIComponent(code)}`, {
    cache: "no-store",
  }).catch(() => null);

  if (!res || !res.ok) {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <p className="text-sm font-bold text-ink">سفارش یافت نشد یا در دسترس نیست.</p>
        <Link href="/" className="mt-4 inline-flex h-11 items-center rounded-full border border-line px-6 text-sm font-bold text-ink">
          {COPY.backToStore}
        </Link>
      </div>
    );
  }

  const order = (await res.json()) as {
    total: string | number;
    paymentStatus: string;
    items: Array<{ titleSnapshot: string; qty: number; lineTotal: string | number }>;
  };

  // گام ۱۸-۱ — پیکربندی کارت‌به‌کارت و آخرین رسید سفارش (سمت سرور؛ سوییچ
  // خاموش = تب اصلاً به مشتری نشان داده نمی‌شود)
  const c2cRes = await fetch(`${API}/api/v1/payments/c2c/config`, {
    cache: "no-store",
  }).catch(() => null);
  const c2c = (await c2cRes?.json().catch(() => null)) as {
    enabled?: boolean;
    expiryHours?: number;
    accounts?: Array<{
      id: string;
      bankName: string;
      displayTitle: string | null;
      holderName: string | null;
      cardNumber: string | null;
      iban: string | null;
      customerInstructions: string | null;
    }>;
  } | null;
  let initialSubmission: {
    state: string;
    referenceNo: string | null;
    decisionNote: string | null;
  } | null = null;
  if (c2c?.enabled) {
    const subRes = await fetch(
      `${API}/api/v1/payments/c2c/by-order/${encodeURIComponent(code)}`,
      { cache: "no-store" },
    ).catch(() => null);
    const sub = (await subRes?.json().catch(() => null)) as {
      state?: string;
      referenceNo?: string | null;
      decisionNote?: string | null;
    } | null;
    if (subRes?.ok && sub?.state) {
      initialSubmission = {
        state: sub.state,
        referenceNo: sub.referenceNo ?? null,
        decisionNote: sub.decisionNote ?? null,
      };
    }
  }

  if (order.paymentStatus === "PAID") {
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center">
        <h1 className="text-lg font-black text-ink">پرداخت انجام شده ✅</h1>
        <p className="mt-2 text-sm text-ink/70">سفارش {code} پرداخت شده و در حال پردازش است.</p>
        <Link href={`/order/${code}`} className="mt-4 inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-on-accent">
          پیگیری سفارش
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-lg font-black text-ink">پرداخت سفارش {code}</h1>
      <div className="mt-4 rounded-card border border-line bg-surface p-5">
        <ul className="divide-y divide-line text-sm">
          {order.items.map((it, idx) => (
            <li key={idx} className="flex items-center justify-between py-2">
              <span className="text-ink/90">{it.titleSnapshot} × {fa(it.qty)}</span>
              <span className="tabular-nums text-ink/90">{fa(it.lineTotal)} تومان</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-base font-black">
          <span>مبلغ قابل پرداخت</span>
          <span className="tabular-nums">{fa(order.total)} تومان</span>
        </div>
        <PayForm
          code={code}
          total={Number(order.total)}
          c2c={{
            enabled: c2c?.enabled === true,
            expiryHours: c2c?.expiryHours ?? 48,
            accounts: c2c?.accounts ?? [],
          }}
          initialSubmission={initialSubmission}
        />
      </div>
    </div>
  );
}
