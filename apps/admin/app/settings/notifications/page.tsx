import PageShell from "@/components/PageShell";
import NotificationsClient from "./clients/NotificationsClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="settings.view" title="اعلان‌ها و صف ارسال">
      <NotificationsClient />
    </PageShell>
  );
}
