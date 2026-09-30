import PageShell from "@/components/PageShell";
import CapabilitiesClient from "./clients/CapabilitiesClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="settings.view" title="پیامک و درگاه پرداخت">
      <CapabilitiesClient />
    </PageShell>
  );
}
