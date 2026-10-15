import { LegalShell, Section, meta } from "@/components/layout/LegalShell";
import { BRANCHES, site } from "@/lib/site";
import { COPY } from "@/lib/copy";

export const metadata = meta(
  `${COPY.legal.about} — ${site.fullName}`,
  "لباس زیر قاصدک چیست و چرا سه شعبه در خیابان عبدالمطلب دارد؟",
);

export default function AboutPage() {
  return (
    <LegalShell
      title={COPY.legal.about}
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
          می‌توانی آنلاین سفارش بدهی و کالا را از نزدیک‌ترین شعبه تحویل بگیری. قیمت‌ها
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

      <Section title={COPY.sizeGuide}>
        <p>
          اگر بین دو سایز مردد هستی، از ابزار <span className="font-medium text-ink">{COPY.sizeGuide}</span>{" "}
          در سایت استفاده کن؛ اندازه‌هایت را می‌پرسد و سایز نزدیک را پیشنهاد می‌دهد.
          اگر باز هم مطمئن نشدی، پیش از خرید از ما بپرس.
        </p>
      </Section>

      <Section title="ارتباط با ما">
        <p>
          اگر سؤالی داری، با شماره{" "}
          <a href={site.phoneHref} dir="ltr" className="font-medium text-primary-strong hover:underline">
            {site.phoneDisplay}
          </a>{" "}
          تماس بگیر یا در اینستاگرام ما را دنبال کن:{" "}
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
