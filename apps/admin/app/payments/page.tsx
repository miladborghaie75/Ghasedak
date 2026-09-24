import PageShell from "@/components/PageShell";
import PaymentsClient from "./PaymentsClient";

export const dynamic = "force-dynamic";

export default function PaymentsPage() {
  return (
    <PageShell permission="payments.view" title="پرداخت‌ها">
      <PaymentsClient />
    </PageShell>
  );
}
