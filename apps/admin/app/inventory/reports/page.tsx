import PageShell from "@/components/PageShell";
import ReportsClient from "./clients/ReportsClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="inventory.reports" title="گزارش‌های انبار">
      <ReportsClient />
    </PageShell>
  );
}
