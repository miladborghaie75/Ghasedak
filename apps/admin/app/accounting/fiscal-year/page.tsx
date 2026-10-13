import PageShell from "@/components/PageShell";
import FiscalYearClient from "./FiscalYearClient";

export const dynamic = "force-dynamic";

/**
 * سال مالی — جدا از «اسناد» و «درخت حساب‌ها».
 *
 * چرا جدا: سال مالی یک تصمیم مدیریتی است (کِی دورهٔ حسابداری بسته شود)،
 * نه یک گزارش. وقتی کنار اسناد باشد، کاربر نمی‌فهمد کدام دکمه سال را
 * می‌بندد و کدام سند را ویرایش می‌کند.
 */
export default function FiscalYearPage() {
  return (
    <PageShell permission="accounting.view" title="سال مالی">
      <p className="mb-4 text-[12px] leading-6 text-muted">
        دورهٔ حسابداری. سال جاری باید همیشه باز باشد تا اسناد ثبت شوند؛ با بستن آن، حساب‌های
        درآمد و هزینه با سند اختتامیه بسته می‌شوند و ترازنامه فقط دارایی، بدهی و سرمایه
        نشان می‌دهد.
      </p>
      <FiscalYearClient />
    </PageShell>
  );
}