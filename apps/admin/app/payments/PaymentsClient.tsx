"use client";

import { useEffect, useState } from "react";
import { useAdminApi, fa } from "@/components/useAdminApi";

interface PaymentRow {
  id: string; amount: string; state: string; providerTxId: string | null;
  failReason: string | null; createdAt: string;
  method: { namePublic: string } | null;
  order?: { code: string } | null;
}

const STATE_FA: Record<string, string> = {
  PAID: "موفق", FAILED: "ناموفق", REDIRECTED: "در انتظار", CREATED: "ایجادشده",
  CALLBACK_RECEIVED: "دریافت callback", VERIFYING: "در حال تایید", EXPIRED: "منقضی",
  CANCELLED: "لغوشده", REQUIRES_REVIEW: "نیازمند بررسی", REFUNDED: "برگشت‌شده",
};

export default function PaymentsClient() {
  const { call, loading } = useAdminApi();
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const r = await call<{ items: PaymentRow[] }>("/admin/payments/list");
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
              <th className="px-4 py-3">سفارش</th><th className="px-4 py-3">روش</th><th className="px-4 py-3">وضعیت</th>
              <th className="px-4 py-3">مبلغ</th><th className="px-4 py-3">شناسه تراکنش</th><th className="px-4 py-3">تاریخ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-ink/50">پرداختی ثبت نشده است.</td></tr>
            ) : rows.map((p) => (
              <tr key={p.id} className="border-b border-line/60 last:border-0">
                <td className="px-4 py-3 font-bold" dir="ltr">{p.order?.code ?? "—"}</td>
                <td className="px-4 py-3">{p.method?.namePublic ?? "—"}</td>
                <td className="px-4 py-3">
                  <span className={p.state === "PAID" ? "font-bold text-green-700" : p.state === "FAILED" ? "font-bold text-red-600" : "font-bold text-amber-600"}>
                    {STATE_FA[p.state] ?? p.state}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums">{fa(p.amount)}</td>
                <td className="px-4 py-3 text-xs" dir="ltr">{p.providerTxId ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-ink/60">{new Date(p.createdAt).toLocaleDateString("fa-IR")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
