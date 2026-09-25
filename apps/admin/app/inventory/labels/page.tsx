import PageShell from "@/components/PageShell";
import LabelPrintClient from "./clients/LabelPrintClient";

export const dynamic = "force-dynamic";

/**
 * چاپ برچسب بارکد کالا — بند ۲۸/۱۱۶ Master:
 * انتخاب واریانت‌ها با picker مشترک، لیبل EAN-13 وکتور، قالب رول حرارتی ۵۰×۳۰ یا A4 آستریک.
 */
export default function Page() {
  return (
    <PageShell
      permission="products.view"
      title="چاپ برچسب بارکد کالا"
      subtitle="انتخاب واریانت‌ها و چاپ برچسب EAN-13 — قالب رول حرارتی ۵۰×۳۰ میلی‌متر یا برگه A4 (۳×۸)"
    >
      <LabelPrintClient />
    </PageShell>
  );
}
