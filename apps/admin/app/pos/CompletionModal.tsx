"use client";

/**
 * فاز ۱۰ — بخش ۴: Sale completion modal.
 * فاکتور/مبلغ/مشتری/روش‌ها + اکشن‌ها: چاپ ۸۰mm، چاپ A4، مشاهده، فروش جدید.
 */

import { fa } from "@/components/useAdminApi";

export function CompletionModal({ invoiceNumber, total, methods, customer, onClose, onPrinted }: {
  invoiceNumber: string;
  total: string;
  methods: string[];
  customer: string | null;
  onClose: () => void;
  onPrinted: (format: "80mm" | "A4") => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-6 text-center shadow-clay-2">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-app-primary-soft text-2xl">✅</div>
        <h2 className="mt-3 text-lg font-black">فاکتور ثبت شد</h2>
        <p className="mt-1 text-2xl font-black tabular-nums text-primary-strong">{fa(total)} <span className="text-sm">تومان</span></p>
        <dl className="mt-4 space-y-1 text-xs text-ink/70">
          <div className="flex justify-between"><dt>شماره فاکتور</dt><dd className="font-bold" dir="ltr">{invoiceNumber}</dd></div>
          <div className="flex justify-between"><dt>روش پرداخت</dt><dd className="font-bold">{methods.join(" + ")}</dd></div>
          {customer ? <div className="flex justify-between"><dt>مشتری</dt><dd className="font-bold">{customer}</dd></div> : null}
        </dl>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={() => void onPrinted("80mm")} className="h-10 rounded-xl bg-ink text-xs font-black text-on-accent">🖨️ چاپ ۸۰mm</button>
          <button onClick={() => void onPrinted("A4")} className="h-10 rounded-xl border border-line text-xs font-bold">چاپ A4</button>
          <a href={`/pos/${invoiceNumber}`} className="col-span-1 flex h-10 items-center justify-center rounded-xl border border-line text-xs font-bold">مشاهده فاکتور</a>
          <button onClick={onClose} className="col-span-1 h-10 rounded-xl bg-primary text-xs font-black text-on-accent">فروش جدید</button>
        </div>
      </div>
    </div>
  );
}
