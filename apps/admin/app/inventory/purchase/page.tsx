import PageShell from "@/components/PageShell";
import PurchaseClient from "./clients/PurchaseClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="purchasing.view" title="خرید از تامین‌کننده">
      <PurchaseClient />
    </PageShell>
  );
}
