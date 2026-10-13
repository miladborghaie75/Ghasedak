import PageShell from "@/components/PageShell";
import ReportsClient from "./ReportsClient";

export const dynamic = "force-dynamic";

/**
 * گزارش‌های مدیریتی — صفحهٔ مستقل.
 *
 * جدا از `/accounting` چون آنجا «دفاتر» است (ساختار و اسناد) و اینجا
 * «گزارش» است (تصمیم‌گیری). قاطی‌کردنشان باعث می‌شد کاربر برای
 * دیدن بدهکاران مجبور باشد از اسناد رد شود.
 */
export default function ReportsPage() {
  return (
    <PageShell permission="accounting.reports" title="گزارش‌های مدیریتی">
      <p className="mb-4 text-[12px] leading-6 text-muted">
        همهٔ گزارش‌ها از دفتر کل خوانده می‌شوند، پس با تراز آزمایشی می‌خوانند. اگر عددی
        با ترازنامه نخواند، یعنی جایی در ثبت سند ایراد است — نه اینکه گزارش را دستی
        درست کنیم.
      </p>
      <ReportsClient />
    </PageShell>
  );
}