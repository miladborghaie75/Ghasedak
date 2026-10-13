import { LegalShell, Section, meta } from "@/components/layout/LegalShell";
import { BRANCHES, site } from "@/lib/site";

export const metadata = meta(
  "درباره ما — لباس زیر قاصدک",
  "لباس زیر قاصدک چیست و چرا سه شعبه در خیابان عبدالمطلب دارد؟",
);

export default function AboutPage() {
  return (
    <LegalShell
      title="درباره ما"
      intro="لباس زیر قاصدک یک فروشگاه تخصصی لباس زیر است؛ برای جایی که انتخاب سایز درست نباید کابوس باشد."
    >
      <Section title="فلسفه ما">
        <p>
          خرید لباس زیر معمولاً با سه نگرانی همراه است: سایزم را نمی‌دانم، جنس پارچه را
          نمی‌شناسم، و بسته‌بندی محترمانه است یا نه. ما فروشگاه را طوری ساخته‌ایم که هر سه
          نگرانی پاسخ روشن داشته باشد.
        </p>
        <p>
          به همین دلیل کنار هر محصول، راهنمای سایز و جدول اندازه وجود دارد؛ جنس پارچه شفاف
          نوشته شده؛ و همه بسته‌ها محترمانه و بدون نمایش محصول بسته‌بندی می‌شوند.
        </p>
      </Section>

      <Section title="سه شعبه، یک قیمت">
        <p>
          شما می‌توانید آنلاین سفارش دهید و کالا را از نزدیک‌ترین شعبه تحویل بگیرید. قیمت‌ها
          در فروشگاه اینترنتی و در شعب یکسان است.
        </p>
        <ul>
          {BRANCHES.map((b) => (
            <li key={b.id}>
              <span className="font-medium text-ink">{b.title}:</span> {b.address}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="راهنمای سایز">
        <p>
          اگر بین دو سایز مردد هستید، از ابزار <span className="font-medium text-ink">راهنمای سایز</span>{" "}
          در سایت استفاده کنید؛ اندازه‌های شما را می‌پرسد و سایز نزدیک را پیشنهاد می‌دهد.
          اگر باز هم مطمئن نشدید، پیش از خرید از ما بپرسید.
        </p>
      </Section>

      <Section title="ارتباط با ما">
        <p>
          اگر سؤالی دارید، با شماره{" "}
          <a href={site.phoneHref} dir="ltr" className="font-medium text-primary-strong hover:underline">
            {site.phoneDisplay}
          </a>{" "}
          تماس بگیرید یا در اینستاگرام ما را دنبال کنید:{" "}
          <a
            href={site.instagram}
            target="_blank"
            rel="noopener noreferrer"
            dir="ltr"
            className="font-medium text-primary-strong hover:underline"
          >
            @{site.instagramHandle}
          </a>
        </p>
      </Section>
    </LegalShell>
  );
}
