import PageShell from "@/components/PageShell";
import ChartOfAccountsClient from "./ChartOfAccountsClient";

export const dynamic = "force-dynamic";

/**
 * کدینگ حساب‌ها — صفحهٔ مستقل از گزارش‌ها.
 *
 * قبلاً این فقط تبی داخل `/accounting` بود و عملاً داده‌ای هم نمی‌گرفت.
 * جدا کردنش باعث می‌شود کاربر بداند دارد **ساختار حساب‌ها** را می‌بیند،
 * نه گزارش مالی — و همچنین امکان ساخت زیرحساب بدون شلوغی ۱۱ تب.
 */
export default function ChartOfAccountsPage() {
  return (
    <PageShell permission="accounting.view" title="کدینگ حساب‌ها">
      <p className="mb-4 text-[12px] leading-6 text-muted">
        ساختار حساب‌های فروشگاه. هر حساب اصلی کد ۴ رقمی دارد و زیرحساب‌هایش با
        الگوی <span dir="ltr">۱۱۰۰-۰۱</span> شماره‌گذاری می‌شوند. برای دیدن اسناد و
        گزارش‌های مالی به «اسناد حسابداری» و «سال مالی» بروید.
      </p>
      <ChartOfAccountsClient />
    </PageShell>
  );
}