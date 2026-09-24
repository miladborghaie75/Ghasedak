"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface OrderRow {
  id: string; code: string; status: string; paymentStatus: string;
  total: string; guestName: string | null; guestMobile: string; createdAt: string;
}

/** سفارش‌ها — جستجو + نمایش صحیح موبایل (۰ ابتدای شماره حفظ می‌شود) */
export default function OrdersClient() {
  const { call, loading } = useAdminApi();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await call<{ items: OrderRow[] }>("/orders");
      if (r.ok && r.data) setRows(r.data.items);
      else setError(r.error?.message ?? "خطا");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="rounded-xl bg-red-50 px-4 py-2 text-xs font-bold text-red-600">{error}</p> : null}
      <div className="overflow-x-auto rounded-card border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-right text-xs text-ink/60">
              <th className="px-4 py-3">شماره</th><th className="px-4 py-3">مشتری</th><th className="px-4 py-3">موبایل</th>
              <th className="px-4 py-3">وضعیت</th><th className="px-4 py-3">پرداخت</th><th className="px-4 py-3">مبلغ</th><th className="px-4 py-3">تاریخ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-ink/50">هنوز سفارشی ثبت نشده است.</td></tr>
            ) : rows.map((o) => (
              <tr key={o.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-bold" dir="ltr">{o.code}</td>
                <td className="px-4 py-3">{o.guestName ?? "مهمان"}</td>
                <td className="px-4 py-3 tabular-nums" dir="ltr">{o.guestMobile}</td>
                <td className="px-4 py-3">{o.status}</td>
                <td className="px-4 py-3">
                  <span className={o.paymentStatus === "PAID" ? "font-bold text-green-700" : "font-bold text-amber-600"}>
                    {o.paymentStatus === "PAID" ? "پرداخت‌شده" : o.paymentStatus === "PENDING" ? "در انتظار" : o.paymentStatus}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums">{fa(o.total)}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{new Date(o.createdAt).toLocaleDateString("fa-IR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
