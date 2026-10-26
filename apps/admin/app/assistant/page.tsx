import PageShell from "@/components/PageShell";
import AssistantClient from "./AssistantClient";

export const dynamic = "force-dynamic";

export default function AssistantPage() {
  return (
    <PageShell
      permission="accounting.reports"
      title="دستیار مدیریت و حسابداری"
      subtitle="پاسخ‌ها از گزارش‌های مجاز و قطعی خوانده می‌شوند؛ ثبت یا تغییر اطلاعات انجام نمی‌شود."
    >
      <AssistantClient />
    </PageShell>
  );
}
