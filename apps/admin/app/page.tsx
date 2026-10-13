import PageShell from "@/components/PageShell";
import DashboardClient from "./dashboard/DashboardClient";

export const metadata = { title: "داشبورد مدیریتی — قاصدک" };
export const dynamic = "force-dynamic";

/**
 * داشبورد مدیریتی — نسخهٔ مالی (فاز ۷).
 *
 * پیش‌تر داشبورد فقط کارت‌های شمارشی ساده داشت (تعداد سفارش، فروش امروز).
 * این نسخه به دفتر کل وصل است، پس عددها با تراز آزمایشی می‌خوانند.
 *
 * برای دیدن کارت‌های عملیاتی قدیمی (سفارش/محصول/انبار) هنوز به صفحهٔ
 * `/dashboard` باار است.
 */
export default function RootDashboardPage() {
  return (
    <PageShell permission="dashboard.view" title="داشبورد مدیریتی">
      <p className="mb-4 text-[12px] leading-6 text-muted">
        همهٔ عددهای مالی از دفتر کل خوانده می‌شوند، پس با تراز آزمایشی می‌خوانند. اگر
        نموداری با ترازنامه نخواند، یعنی جایی در ثبت سند ایراد است.
      </p>
      <DashboardClient />
    </PageShell>
  );
}