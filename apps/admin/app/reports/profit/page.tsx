import PageShell from "@/components/PageShell";
import ProfitClient from "./ProfitClient";

export const dynamic = "force-dynamic";

/** گزارش سود واقعی — از اسناد GL + بهای میانگین انبار؛ بدون عدد ساختگی */
export default function ProfitPage() {
  return (
    <PageShell
      permission="accounting.reports"
      title="گزارش سود واقعی"
      subtitle="فروش و بهای تمام‌شدهٔ اسناد واقعی سفارش‌ها؛ سطرِ بدون بهای ثبت‌شده صادقانه «نامشخص» می‌ماند"
    >
      <ProfitClient />
    </PageShell>
  );
}
