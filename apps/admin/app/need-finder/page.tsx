import PageShell from "@/components/PageShell";
import NeedFinderClient from "./clients/NeedFinderClient";

export const dynamic = "force-dynamic";

/**
 * مدیریت ویزارد «چی لازم داری؟» (گام ۱۶) — گام‌ها، گزینه‌ها و قاعدهٔ انطباق.
 * الگوی server page + client؛ خواندن با marketing.view و نوشتن با marketing.manage.
 */
export default function Page() {
  return (
    <PageShell
      permission="marketing.view"
      title="ویزارد «چی لازم داری؟»"
      subtitle="گام‌ها و گزینه‌های ویزارد فروشگاه را اینجا می‌چینی. قاعدهٔ هر گزینه مستقیم روی نتیجهٔ فروشگاه اثر می‌گذارد، پس دسته و جنس را از فهرست کاتالوگ انتخاب کن."
    >
      <NeedFinderClient />
    </PageShell>
  );
}
