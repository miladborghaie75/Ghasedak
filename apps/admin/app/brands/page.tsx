import PageShell from "@/components/PageShell";
import BrandsClient from "./clients/BrandsClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="brands.view" title="برندها">
      <BrandsClient />
    </PageShell>
  );
}
