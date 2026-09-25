import PageShell from "@/components/PageShell";
import InvoiceDetailClient from "./clients/InvoiceDetailClient";

export const dynamic = "force-dynamic";

/**
 * جزئیات فاکتور خرید — بند ۲۷ Master:
 * snapshot تامین‌کننده + ردیف‌ها + پرداخت‌ها + AP + اثر انبار/حسابداری + audit + چاپ.
 * سند POSTED immutable است — اصلاح فقط با سازوکار برگشت/اعتبار.
 */
export default function Page() {
  return (
    <PageShell permission="purchasing.view" title="جزئیات فاکتور خرید">
      <InvoiceDetailClient />
    </PageShell>
  );
}
