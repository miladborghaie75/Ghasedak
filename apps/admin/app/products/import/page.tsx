import PageShell from "@/components/PageShell";
import ImportClient from "./clients/ImportClient";

export const dynamic = "force-dynamic";

/** ورود گروهی محصولات (گام ۱۳ · F1-3) — preview، apply، rollback */
export default function Page() {
  return (
    <PageShell
      permission="products.view"
      title="ورود گروهی محصولات"
      subtitle="فایل CSV را پیش‌نمایش کن؛ تا تأیید نهایی هیچ محصولی نوشته نمی‌شود."
    >
      <ImportClient />
    </PageShell>
  );
}
