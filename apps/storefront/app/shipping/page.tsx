import { LegalShell, Section, meta } from "@/components/layout/LegalShell";
import { site } from "@/lib/site";
import { COPY } from "@/lib/copy";

export const metadata = meta(
  `${COPY.legal.shipping} — ${site.fullName}`,
  "ارسال سریع پستی، تحویل حضوری از سه شعبه قاصدک و نحوه پیگیری سفارش.",
);

export default function ShippingPage() {
  return (
    <LegalShell
      title={COPY.legal.shipping}
      intro="می‌توانید سفارش را پستی بگیرید یا از نزدیک‌ترین شعبه حضوری تحویل بگیرید."
    >
      <Section title="۱) ارسال پستی">
        <ul>
          <li>سفارش‌های ثبت‌شده تا ساعت ۱۴، همان روز ارسال می‌شوند.</li>
          <li>بسته‌بندی محرمانه است و نام محصول روی بسته درج نمی‌شود.</li>
          <li>هزینه ارسال در مرحله پرداخت، پیش از ثبت نهایی سفارش نمایش داده می‌شود.</li>
          <li>پس از تحویل به پست، کد رهگیری برای شما پیامک می‌شود.</li>
        </ul>
      </Section>

      <Section title="۲) تحویل حضوری از شعب">
        <ul>
          <li>اگر نزدیک ما هستید، می‌توانید سفارش را ثبت کنید و از یکی از شعب زیر بگیرید.</li>
          <li>در این حالت هزینه ارسال ندارید.</li>
          <li>پیش از مراجعه، حتماً از طریق شماره تماس هماهنگ کنید تا کالا موجود باشد.</li>
        </ul>
        <ul>
          <li>
            <span className="font-medium text-ink">شعبه ۱:</span> عبدالمطلب ۱۵، بین یاس ۲ و ۴
          </li>
          <li>
            <span className="font-medium text-ink">شعبه ۲:</span> عبدالمطلب ۱۵، بین یاس ۴ و ۶
          </li>
          <li>
            <span className="font-medium text-ink">شعبه ۳:</span> بین عبدالمطلب ۱۵ و چهارراه عبدالمطلب
          </li>
        </ul>
      </Section>

      <Section title="پیگیری سفارش">
        <p>
          پس از ثبت سفارش، کد سفارش نمایش داده می‌شود و همان لحظه برای شما پیامک می‌شود.
          به‌محض تحویل مرسوله به پست، کد رهگیری پستی برایتان ثبت می‌شود.
        </p>
        <p className="mt-2">
          کد رهگیری پستی یا کد سفارش را در صفحهٔ{" "}
          <a href="/track" className="font-bold text-primary-strong underline">
            پیگیری مرسوله
          </a>{" "}
          وارد کنید تا ببینید بستهٔ شما در کدام مرحله است.
        </p>
      </Section>

      <Section title="ساعات ارسال">
        <p>
          سفارش‌های ثبت‌شده در روزهای کاری ({site.workingHours}) پردازش می‌شوند. سفارش ثبت‌شده در
          روزهای تعطیل، اولین روز کاری بعد ارسال خواهد شد.
        </p>
      </Section>

      <Section title="تأخیر احتمالی">
        <p>
          در روزهای شلوغ یا شرایط جوی نامساعد ممکن است زمان تحویل کمی بیشتر شود. پیگیری مرسوله
          از طریق کد رهگیری پستی که برایتان پیامک می‌شود امکان‌پذیر است.
        </p>
      </Section>
    </LegalShell>
  );
}
