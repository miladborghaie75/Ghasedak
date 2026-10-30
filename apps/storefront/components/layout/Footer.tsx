import Link from "next/link";
import { BRANCHES, site } from "@/lib/site";
import { COPY } from "@/lib/copy";
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

          <nav aria-label={COPY.shoppingGuide}>
            <p className="mb-3 text-sm font-extrabold text-plum">{COPY.shoppingGuide}</p>
            <ul className="space-y-0.5">
              <li><FooterLink href="/guides/size">{COPY.sizeGuide}</FooterLink></li>
<li><FooterLink href="/returns">{COPY.legal.returns}</FooterLink></li>
            <li><FooterLink href="/shipping">{COPY.legal.shipping}</FooterLink></li>
            <li><FooterLink href="/track">پیگیری مرسوله</FooterLink></li>
              <li><FooterLink href="/search">جستجوی محصولات</FooterLink></li>
              <li><FooterLink href="/cart">سبد خرید</FooterLink></li>
            </ul>
          </nav>

          <nav aria-label="تماس و فروشگاه">
            <p className="mb-3 text-sm font-extrabold text-plum">تماس و فروشگاه</p>
            <ul className="space-y-1 text-[13px] text-muted">
              <li><FooterLink href="/contact">{COPY.legal.contact}</FooterLink></li>
              <li><FooterLink href="/about">{COPY.legal.about}</FooterLink></li>
              <li><FooterLink href="/terms">{COPY.legal.terms}</FooterLink></li>
              <li><FooterLink href="/privacy">{COPY.legal.privacy}</FooterLink></li>
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

        <div className="mt-8 flex flex-col items-center gap-2 border-t border-line pt-5">
          {/*
            نشان اعتماد الکترونیکی (اینماد) — کد رسمی صادرشده برای همین دامنه.
            «referrerPolicy="origin"» عمداً همان چیزی است که کد رسمی می‌خواهد؛
            سامانه با آن دامنهٔ میزبان نشان را می‌سنجد. بدون noreferrer.
          */}
          <a
            href="https://trustseal.enamad.ir/?id=8443966&Code=Ts1ukgqIv9Qa9Kmapjmv8ohTbtavNXBv"
            target="_blank"
            rel="noopener"
            referrerPolicy="origin"
            aria-label="نشان اعتماد الکترونیکی (اینماد) — مشاهدهٔ مجوز در سامانه"
            className="inline-flex min-h-11 items-center rounded-xl p-1 transition-opacity hover:opacity-90"
          >
            <img
              src="https://trustseal.enamad.ir/logo.aspx?id=8443966&Code=Ts1ukgqIv9Qa9Kmapjmv8ohTbtavNXBv"
              alt="نشان اعتماد الکترونیکی (اینماد)"
              referrerPolicy="origin"
              width={80}
              height={80}
              loading="lazy"
              decoding="async"
              className="h-20 w-20 cursor-pointer object-contain"
              {...{ code: "Ts1ukgqIv9Qa9Kmapjmv8ohTbtavNXBv" }}
            />
          </a>
          <p className="text-center text-xs leading-6 text-muted">
            © {new Date().getFullYear()} {site.fullName} — همه حقوق محفوظ است.
          </p>
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
