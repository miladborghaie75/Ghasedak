import PageShell from "@/components/PageShell";
import InvoiceWorkspace from "./clients/InvoiceWorkspace";

export const dynamic = "force-dynamic";

/**
 * میزکار فاکتور خرید — بند ۲۷ Master:
 * صفحه اختصاصی (لینک قابل باز شدن در تب جدید)، انتخاب کالا با ProductPicker،
 * snapshot کامل و پیوست — به‌جای فرم کوچک داخل تب.
 */
export default function Page() {
  return (
    <PageShell
      permission="purchasing.view"
      title="فاکتور خرید جدید"
      subtitle="انتخاب کالا با جستجو/بارکد، هزینه‌ها و پرداخت — پس از ثبت، سند immutable و از صفحه جزئیات قابل چاپ است"
    >
      <InvoiceWorkspace />
    </PageShell>
  );
}
