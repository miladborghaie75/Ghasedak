import Link from "next/link";
import { BRANCHES, site } from "@/lib/site";
import { CATEGORIES as categories } from "@/lib/categories";

export function Footer() {
  return (
    // روی کاغذ تکرار نمی‌شود — اطلاعات تماس در برگهٔ چاپی خودش می‌آید
    <footer className="mt-16 px-3 pb-24 sm:px-4 lg:pb-8 print:hidden">
      <div className="mx-auto max-w-7xl rounded-blob border border-line bg-surface p-6 shadow-clay-1 sm:p-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="mb-3 text-sm font-extrabold text-plum">{site.fullName}</p>
            <p className="text-[13px] leading-7 text-muted">
              خرید لباس زیر باید ساده و بی‌دغدغه باشد: سایز درست، اطلاعات شفاف و
              ارسال سریع — بدون هیچ ابهامی.
            </p>
            <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
              <a
                href={site.phoneHref}
                dir="ltr"
                className="inline-flex min-h-11 items-center font-bold text-primary-strong hover:underline"
              >
                {site.phoneDisplay}
              </a>
              <a
                href={site.instagram}
                target="_blank"
                rel="noopener noreferrer"
                dir="ltr"
                className="inline-flex min-h-11 items-center text-muted hover:text-primary-strong"
              >
                @{site.instagramHandle}
              </a>
            </p>
          </div>

          <nav aria-label="دسته‌ها">
            <p className="mb-3 text-sm font-extrabold text-plum">دسته‌ها</p>
            <ul className="space-y-0.5">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/c/${c.slug}`}
                    className="inline-flex min-h-11 items-center text-[13px] text-muted hover:text-primary-strong"
                  >
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="راهنمای خرید">
            <p className="mb-3 text-sm font-extrabold text-plum">راهنمای خرید</p>
            <ul className="space-y-0.5">
              <li><FooterLink href="/guides/size">راهنمای سایز</FooterLink></li>
<li><FooterLink href="/returns">شرایط بازگشت کالا</FooterLink></li>
            <li><FooterLink href="/shipping">روش‌های ارسال</FooterLink></li>
            <li><FooterLink href="/track">پیگیری مرسوله</FooterLink></li>
              <li><FooterLink href="/search">جستجوی محصولات</FooterLink></li>
              <li><FooterLink href="/cart">سبد خرید</FooterLink></li>
            </ul>
          </nav>

          <nav aria-label="تماس و فروشگاه">
            <p className="mb-3 text-sm font-extrabold text-plum">تماس و فروشگاه</p>
            <ul className="space-y-1 text-[13px] text-muted">
              <li><FooterLink href="/contact">تماس با ما</FooterLink></li>
              <li><FooterLink href="/about">درباره ما</FooterLink></li>
              <li><FooterLink href="/terms">قوانین و مقررات</FooterLink></li>
              <li><FooterLink href="/privacy">حریم خصوصی</FooterLink></li>
            </ul>
            <p className="mt-3 text-[13px] font-bold text-plum">شعب فروشگاه</p>
            <ul className="mt-1 space-y-1 text-[13px] text-muted">
              {BRANCHES.map((b) => (
                <li key={b.id}>
                  <span className="font-medium text-ink">{b.title}:</span> {b.address}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">پاسخ‌گویی: {site.workingHours}</p>
          </nav>
        </div>

        <div className="mt-8 border-t border-line pt-5 text-center text-xs leading-6 text-muted">
          <p>© {new Date().getFullYear()} {site.fullName} — همه حقوق محفوظ است.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center text-[13px] text-muted hover:text-primary-strong"
    >
      {children}
    </Link>
  );
}
