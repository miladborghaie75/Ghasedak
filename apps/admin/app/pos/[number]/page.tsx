import PageShell from "@/components/PageShell";
import InvoiceDetailClient from "./InvoiceDetailClient";

export const dynamic = "force-dynamic";

export default async function PosInvoiceDetailPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  return (
    <PageShell permission="pos.view" title={`فاکتور ${decodeURIComponent(number)}`}>
      <InvoiceDetailClient invoiceNumber={decodeURIComponent(number)} />
    </PageShell>
  );
}
