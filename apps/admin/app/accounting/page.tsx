import PageShell from "@/components/PageShell";
import AccountingClient from "./AccountingClient";

export const dynamic = "force-dynamic";

/** درخت حساب‌ها و کدینگ — فقط ساختار، نه اسناد */
export default function AccountingPage() {
  return (
    <PageShell permission="accounting.view" title="درخت حساب‌ها و کدینگ">
      <p className="mb-4 text-[12px] leading-6 text-muted">
        ساختار حساب‌ها و کدینگ حسابداری، با ماندهٔ هر حساب از دفتر واقعی. برای دیدن و اصلاح
        اسناد به صفحهٔ «اسناد حسابداری» بروید.
      </p>
      <AccountingClient />
    </PageShell>
  );
}