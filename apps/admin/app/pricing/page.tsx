import PageShell from "@/components/PageShell";
import PricingClient from "./clients/PricingClient";

export default function PricingPage() {
  return (
    <PageShell
      permission="pricing.view"
      title="قیمت‌گذاری کانالی"
      subtitle="سطوح قیمت (POS/وب/ترب/اسنپ‌پی) — تغییر با تاریخچه و رویداد؛ هر کانال فقط قیمت سطح خودش را می‌بیند"
    >
      <PricingClient />
    </PageShell>
  );
}
