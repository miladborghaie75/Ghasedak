import PageShell from "@/components/PageShell";
import AccountingClient from "./AccountingClient";

export const dynamic = "force-dynamic";

export default function AccountingPage() {
  return (
    <PageShell permission="accounting.view" title="حسابداری">
      <AccountingClient />
    </PageShell>
  );
}
