import PageShell from "@/components/PageShell";
import JournalEditor from "../JournalEditor";

export const dynamic = "force-dynamic";

/**
 * اسناد حسابداری — صفحهٔ مستقل.
 *
 * عمداً از «درخت حساب‌ها» جداست: درخت یعنی *ساختار* حساب‌ها و کدینگ،
 * اسناد یعنی *حرکت‌های مالی*. قاطی کردنشان باعث می‌شد برای پیدا کردن یک
 * سند مجبور شوی کل درخت را باز کنی.
 */
export default function JournalPage() {
  return (
    <PageShell permission="accounting.view" title="اسناد حسابداری">
<p className="mb-4 text-[12px] leading-6 text-muted">
          مرور و اصلاح اسناد. سند «پیش‌نویس» مستقیم قابل ویرایش و حذف است؛ سند «قطعی» برای
          حفظ تاریخچهٔ دفاتر مستقیم تغییر نمی‌کند — اول آن را به پیش‌نویس برمی‌گردانیم (و از
          دفاتر بیرون می‌آید)، اصلاحش می‌کنیم و دوباره قطعی می‌کنیم. برای چاپ یا پیوست
          مدارک (فاکتور کاغذی، رسید کارت‌خوان) از دکمهٔ «چاپ / پیوست» هر سند استفاده کنید.
        </p>
      <JournalEditor />
    </PageShell>
  );
}