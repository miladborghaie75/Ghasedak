import Link from "next/link";
import { LegalShell, Section, meta } from "@/components/layout/LegalShell";
import { BRANCHES, RETURN_POLICY, site } from "@/lib/site";

export const metadata = meta(
  "تماس با ما — لباس زیر قاصدک",
  "راه‌های ارتباط با لباس زیر قاصدک: شماره تماس، سه شعبه در خیابان عبدالمطلب و صفحه اینستاگرام.",
);

export default function ContactPage() {
  return (
    <LegalShell
      title="تماس با ما"
      intro="پاسخ‌گویی ما در ساعات کاری، همان روز انجام می‌شود. برای پیگیری سفارش، کد سفارش را همراه داشته باشید."
    >
      <Section title="شماره تماس">
        <p>
          <a
            href={site.phoneHref}
            dir="ltr"
            className="text-base font-bold text-primary-strong hover:underline"
          >
            {site.phoneDisplay}
          </a>
          <span className="ms-2 text-xs text-muted">({site.workingHours})</span>
        </p>
        <p>
          ایمیل:{" "}
          <a href={`mailto:${site.email}`} dir="ltr" className="text-primary-strong hover:underline">
            {site.email}
          </a>
        </p>
      </Section>

      <Section title="شعب فروشگاه">
        <p>برای دیدن و پرو کردن لباس‌ها می‌توانید به هر سه شعبه سر بزنید:</p>
        <ul>
          {BRANCHES.map((b) => (
            <li key={b.id}>
              <span className="font-medium text-ink">{b.title}:</span> {b.address}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="اینستاگرام">
        <p>
          جدیدترین محصولات و موجودی شعب را در صفحه اینستاگرام ما ببینید:{" "}
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

      <Section title="پیش از تماس">
        <ul>
          <li>
            برای پیگیری سفارش، کد آن را از صفحه{" "}
            <Link href="/order" className="text-primary-strong hover:underline">
              پیگیری سفارش
            </Link>{" "}
            بردارید.
          </li>
          <li>
            شرایط بازگشت کالا در صفحه{" "}
            <Link href="/returns" className="text-primary-strong hover:underline">
              بازگشت کالا
            </Link>{" "}
            آمده است؛ پیش از تماس درباره مرجوعی، آن بخش را بخوانید.
          </li>
        </ul>
      </Section>

      <p className="rounded-2xl border border-line bg-surface p-4 text-xs leading-6 text-muted">
        یادآوری: بازگشت کالا فقط برای کالای سالم، بدون لکه و با مارک کنده‌نشده و در
        مهلت {RETURN_POLICY.windowDays} روز امکان‌پذیر است، چون لباس زیر کالای بهداشتی است.
      </p>
    </LegalShell>
  );
}
