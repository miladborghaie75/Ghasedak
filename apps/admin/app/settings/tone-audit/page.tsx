import PageShell from "@/components/PageShell";
import ToneAuditClient from "./clients/ToneAuditClient";

export const dynamic = "force-dynamic";

/**
 * ممیزی لحن — نقض‌های قواعد R1–R7 هر دو اپ (ادمین + فروشگاه) از همان
 * هستهٔ مشترک تست نگهبان؛ اصلاح با پیشنهاد دستیار AI و انتشار با تأیید.
 */
export default function Page() {
  return (
    <PageShell
      permission="settings.view"
      title="ممیزی لحن"
      subtitle="نقض‌های قواعد لحن متن‌های رابط کاربر — پیشنهاد دستیار، بازبینی و انتشار با تأیید"
    >
      <ToneAuditClient />
    </PageShell>
  );
}
