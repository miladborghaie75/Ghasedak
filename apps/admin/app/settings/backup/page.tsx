import PageShell from "@/components/PageShell";
import BackupStatusClient from "./clients/BackupStatusClient";

export const dynamic = "force-dynamic";

/** پشتیبان‌گیری (بند ۴) — الگوی server page + client */
export default function Page() {
  return (
    <PageShell permission="settings.view" title="پشتیبان‌گیری">
      <BackupStatusClient />
    </PageShell>
  );
}
