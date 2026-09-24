import PageShell from "@/components/PageShell";
import UsersClient from "./clients/UsersClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <PageShell permission="users.view" title="کاربران">
      <UsersClient />
    </PageShell>
  );
}
