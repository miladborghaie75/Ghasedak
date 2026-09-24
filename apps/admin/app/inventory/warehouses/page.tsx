import PageShell from "@/components/PageShell";
import WarehousesClient from "./clients/WarehousesClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="inventory.view" title="انبارها">
      <WarehousesClient />
    </PageShell>
  );
}
