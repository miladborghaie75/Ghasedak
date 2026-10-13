import PageShell from "@/components/PageShell";
import SettlementClient from "./SettlementClient";

export const dynamic = "force-dynamic";

/**
 * تسویهٔ درگاه — فاز ۲٫۵
 *
 * برای درگاه اعتباری، پولِ مشتری همان لحظه به حساب ما نمی‌رسد. این صفحه
 * جایی است که مدیر **گزارش تسویهٔ درگاه** را وارد می‌کند و سند تسویه صادر
 * می‌شود — یعنی پول از حساب «طلب از درگاه» به بانک منتقل می‌گردد.
 *
 * تنظیم کارمزد و روزهای تسویه، به‌ازای هر درگاه، در صفحهٔ «پیامک و درگاه پرداخت».
 */
export default function SettlementsPage() {
  return (
    <PageShell permission="payments.view" title="تسویهٔ درگاه">
      <p className="mb-4 text-[12px] leading-6 text-muted">
        پرداخت‌های اعتباری تا تسویه در حساب «طلب از درگاه» می‌مانند و موجودی بانک را بالا نشان
        نمی‌دهند. با ثبت هر گزارش تسویه، پول به حساب بانک منتقل و کارمزد جدا ثبت می‌شود.
      </p>
      <SettlementClient />
    </PageShell>
  );
}