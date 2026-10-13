import { LegalShell, Section, meta } from "@/components/layout/LegalShell";
import { BRANCHES, RETURN_POLICY, site } from "@/lib/site";

export const metadata = meta(
  "شرایط بازگشت کالا — لباس زیر قاصدک",
  "شرایط بازگشت کالای لباس زیر قاصدک: مهلت ۷ روز، کالای سالم و بدون لکه با مارک کنده‌نشده.",
);

export default function ReturnsPage() {
  return (
    <LegalShell
      title="شرایط بازگشت کالا"
      intro="لباس زیر کالای بهداشتی است و برای حفظ سلامت شما و دیگران، شرایط بازگشت آن دقیق و شفاف اعلام می‌شود."
    >
      <Section title="چرا شرط بازگشت سخت‌گیرانه است؟">
        <p>{RETURN_POLICY.reason}</p>
        <p>
          اگر کالایی پوشیده شده باشد، امکان بازگرداندن آن به قفسه فروش وجود ندارد؛ بنابراین
          چنین کالایی پذیرفته نمی‌شود و مبلغ آن بازگردانده نمی‌شود.
        </p>
      </Section>

      <Section title="شرایطی که باید هم‌زمان برقرار باشد">
        <ul>
          <li>
            مهلت بازگشت از زمان تحویل کالا حداکثر{" "}
            <span className="font-medium text-ink">{RETURN_POLICY.windowDays} روز</span> باشد.
          </li>
          <li>
            کالا <span className="font-medium text-ink">{RETURN_POLICY.condition}</span> باشد.
          </li>
          <li>کالا پوشیده نشده و بو، لکه، اثر استفاده یا کشیدگی نداشته باشد.</li>
          <li>بسته‌بندی و مارک محصول کنده نشده باشد.</li>
          <li>همراه با فاکتور یا کد سفارش به فروشگاه تحویل شود.</li>
        </ul>
      </Section>

      <Section title="مواردی که بازگشت پذیرفته نمی‌شود">
        <ul>
          <li>کالایی که نشانه‌ای از استفاده دارد یا پوشیده شده است.</li>
          <li>کالایی که شست‌وشو شده یا کشیدگی آن از حد مجاز بیشتر است.</li>
          <li>کالایی که مارک آن کنده شده یا همراه خود پروکت و لوازم جانبی‌اش ناقص است.</li>
          <li>محصولات بهداشتی تک‌مصرف که بسته‌بندی آن‌ها باز شده است.</li>
        </ul>
      </Section>

      <Section title="مراحل بازگشت">
        <ul>
          <li>با شماره {site.phoneDisplay} تماس بگیرید یا به یکی از شعب زیر مراجعه کنید.</li>
          <li>کالا و کد سفارش را همراه داشته باشید.</li>
          <li>کالا در همان شعبه بررسی می‌شود؛ اگر شرایط برقرار باشد، مبلغ بازگردانده می‌شود.</li>
        </ul>
      </Section>

      <Section title="شعب تحویل مرجوعی">
        <ul>
          {BRANCHES.map((b) => (
            <li key={b.id}>
              <span className="font-medium text-ink">{b.title}:</span> {b.address}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="مهلت بازگشت وجه">
        <p>
          پس از تأیید کالا، مبلغ{" "}
          <span className="font-medium text-ink">حداکثر تا ۷۲ ساعت کاری</span> به همان روشی که
          پرداخت کرده‌اید بازگردانده می‌شود.
        </p>
      </Section>
    </LegalShell>
  );
}
