import PageShell from "@/components/PageShell";
import TreasuryClient from "./TreasuryClient";

export const dynamic = "force-dynamic";

export default function TreasuryPage() {
  return (
    <PageShell permission="treasury.view" title="خزانه — نقد و بانک">
      <TreasuryClient />
    </PageShell>
  );
}
