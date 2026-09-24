import PageShell from "@/components/PageShell";
import AttributesClient from "./clients/AttributesClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="attributes.view" title="ویژگی‌ها">
      <AttributesClient />
    </PageShell>
  );
}
