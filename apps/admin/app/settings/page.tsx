import PageShell from "@/components/PageShell";
import SettingsClient from "./clients/SettingsClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="settings.view" title="تنظیمات">
      <SettingsClient />
    </PageShell>
  );
}
