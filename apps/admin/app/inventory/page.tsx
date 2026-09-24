import PageShell from "@/components/PageShell";
import InventoryClient from "./clients/InventoryClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="inventory.view" title="موجودی">
      <InventoryClient />
    </PageShell>
  );
}
