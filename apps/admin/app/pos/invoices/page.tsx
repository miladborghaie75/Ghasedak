import PageShell from "@/components/PageShell";
import InvoiceListClient from "./InvoiceListClient";

export const dynamic = "force-dynamic";

export default function PosInvoicesPage() {
  return (
    <PageShell permission="pos.view" title="فاکتورهای فروش POS">
      <InvoiceListClient />
    </PageShell>
  );
}
