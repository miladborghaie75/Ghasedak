import PageShell from "@/components/PageShell";
import C2cClient from "./C2cClient";

export const dynamic = "force-dynamic";

export default function C2cPaymentsPage() {
  return (
    <PageShell
      permission="payments.view"
      title="رسیدهای کارت‌به‌کارت"
      subtitle="رسیدهایی که مشتری برای واریز دستی ثبت کرده — تأیید، رد یا درخواست اصلاح؛ کارت‌های فروشگاه و روشن/خاموش‌کردن این روش هم همین‌جاست."
    >
      <C2cClient />
    </PageShell>
  );
}
