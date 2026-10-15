import { LegalShell, Section, meta } from "@/components/layout/LegalShell";
import { RETURN_POLICY, site } from "@/lib/site";
import { COPY } from "@/lib/copy";

export const metadata = meta(
  `${COPY.legal.terms} — ${site.fullName}`,
  "شرایط استفاده از فروشگاه اینترنتی لباس زیر قاصدک: ثبت سفارش، پرداخت، قیمت‌ها و بازگشت کالا.",
);

export default function TermsPage() {
  return (
    <LegalShell
      title={COPY.legal.terms}
      intro="استفاده از فروشگاه اینترنتی لباس زیر قاصدک به‌معنای پذیرش شرایط زیر است."
      updated="مهر ۱۴۰۵"
    >
      <Section title="فروشنده">
        <p>
          فروشنده لباس زیر قاصدک است. برای هرگونه پیگیری می‌توانید با شماره{" "}
          <a href={site.phoneHref} dir="ltr" className="font-medium text-primary-strong hover:underline">
            {site.phoneDisplay}
          </a>{" "}
          تماس بگیرید.
        </p>
      </Section>

      <Section title="قیمت‌ها و موجودی">
        <ul>
          <li>قیمت‌ها به تومان و مطابق قیمت درج‌شده در سایت در لحظه ثبت سفارش است.</li>
          <li>در صورت ناموجود شدن یا اشتباه در قیمت، سفارش لغو و مبلغ به‌کامل بازگردانده می‌شود.</li>
          <li>موجودی انبار به‌صورت لحظه‌ای در سایت نمایش داده می‌شود.</li>
        </ul>
      </Section>

      <Section title="ثبت سفارش و پرداخت">
        <ul>
          <li>سفارش شما پس از ثبت نهایی و پرداخت موفق قطعی می‌شود.</li>
          <li>اطلاعات ارسال باید دقیق و کامل باشد؛ نشانی اشتباه، مسئولیت تأخیر را بر عهدهٔ خریدار می‌گذارد.</li>
          <li>پرداخت از طریق درگاه بانکی معتبر انجام می‌شود. اطلاعات کارت شما در فروشگاه ذخیره نمی‌شود.</li>
        </ul>
      </Section>

      <Section title="بازگشت کالا">
        <ul>
          <li>مهلت بازگشت کالا {RETURN_POLICY.windowDays} روز از زمان تحویل است.</li>
          <li>کالا باید {RETURN_POLICY.condition} باشد.</li>
          <li>{RETURN_POLICY.reason}</li>
          <li>شرایط کامل در صفحه «شرایط بازگشت کالا» آمده است.</li>
        </ul>
      </Section>

      <Section title="حریم خصوصی و مسئولیت">
        <ul>
          <li>اطلاعات مشتری فقط برای پردازش و ارسال سفارش استفاده می‌شود.</li>
          <li>ما در قیمت‌گذاری از روش‌های خودکار و بدون دخالت انسان استفاده می‌کنیم.</li>
        </ul>
      </Section>

      <Section title="حق تغییر">
        <p>
          فروشنده می‌تواند در آینده شرایط این صفحه را به‌روز کند؛ نسخه معتبر، همان متنی است که
          در لحظه ثبت سفارش در سایت منتشر شده است.
        </p>
      </Section>
    </LegalShell>
  );
}
