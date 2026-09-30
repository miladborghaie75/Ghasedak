import PageShell from "@/components/PageShell";
import DiagnosticsClient from "./clients/DiagnosticsClient";

export const dynamic = "force-dynamic";

/** مرکز عیب‌یابی (بند ۸) — الگوی server page + client */
export default function Page() {
  return (
    <PageShell permission="settings.view" title="مرکز عیب‌یابی">
      <DiagnosticsClient />
    </PageShell>
  );
}
