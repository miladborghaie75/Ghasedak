import PageShell from "@/components/PageShell";
import PosClient from "./PosClient";

export const dynamic = "force-dynamic";

export default function PosPage() {
  return (
    <PageShell permission="pos.view" title="صندوق فروش (POS)">
      <PosClient />
    </PageShell>
  );
}
