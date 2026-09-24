import PageShell from "@/components/PageShell";
import AuditClient from "./clients/AuditClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="audit.view" title="Audit Log">
      <AuditClient />
    </PageShell>
  );
}
