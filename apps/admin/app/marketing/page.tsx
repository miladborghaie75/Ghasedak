import PageShell from "@/components/PageShell";
import MarketingClient from "./clients/MarketingClient";

export const dynamic = "force-dynamic";

/** بازاریابی — کوپن (بند ۳۹) + گزارش فروش (بند ۳۱) — الگوی server page + client */
export default function Page() {
  return (
    <PageShell permission="marketing.view" title="کدهای تخفیف و گزارش فروش">
      <MarketingClient />
    </PageShell>
  );
}
