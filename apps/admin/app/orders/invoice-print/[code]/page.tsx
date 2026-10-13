import PageShell from "@/components/PageShell";
import InvoicePrintClient from "./invoice-print-client";

export const dynamic = "force-dynamic";

/**
 * چاپ فاکتور فروش آنلاین (فاز ۴).
 *
 * مسیر با «کد سفارش» است نه id، چون همین قالب برای مشتری هم کاربرد دارد
 * (همان endpoint عمومی `by-code`) و چاپ فاکتور خریدار در فروشگاه هم
 * با همین آدرس ممکن می‌شود.
 */
export default async function InvoicePrintPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <PageShell permission="orders.view" title="چاپ فاکتور فروش">
      <InvoicePrintClient code={decodeURIComponent(code)} />
    </PageShell>
  );
}