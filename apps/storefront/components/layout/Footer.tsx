import Link from "next/link";
import { site } from "@/lib/site";
import { CATEGORIES as categories } from "@/lib/categories";

export function Footer() {
  return (
    <footer className="mt-16 px-3 pb-8 sm:px-4">
      <div className="mx-auto max-w-7xl rounded-blob border border-line bg-surface p-6 shadow-clay-1 sm:p-10">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="mb-3 text-sm font-extrabold text-plum">{site.fullName}</p>
            <p className="text-[13px] leading-7 text-muted">
              خرید لباس زیر باید ساده و بی‌دغدغه باشد: سایز درست، اطلاعات شفاف و
              ارسال سریع — بدون هیچ ابهامی.
            </p>
          </div>

          <nav aria-label="دسته‌ها">
            <p className="mb-3 text-sm font-extrabold text-plum">دسته‌ها</p>
            <ul className="space-y-2">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link href={`/c/${c.slug}`} className="text-[13px] text-muted hover:text-primary-strong">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="کمک خرید">
            <p className="mb-3 text-sm font-extrabold text-plum">کمک خرید</p>
            <ul className="space-y-2">
              <li><Link href="/guides/size" className="text-[13px] text-muted hover:text-primary-strong">راهنمای سایز</Link></li>
              <li><Link href="/wishlist" className="text-[13px] text-muted hover:text-primary-strong">علاقه‌مندی‌ها</Link></li>
              <li><Link href="/cart" className="text-[13px] text-muted hover:text-primary-strong">سبد خرید</Link></li>
              <li><Link href="/search" className="text-[13px] text-muted hover:text-primary-strong">جستجوی محصولات</Link></li>
            </ul>
          </nav>

          <div>
            <p className="mb-3 text-sm font-extrabold text-plum">تماس</p>
            <p className="text-[13px] leading-7 text-muted">
              ایمیل: <span dir="ltr">{site.email}</span>
              <br />
              پاسخ‌گویی: شنبه تا پنجشنبه
            </p>
          </div>
        </div>

        <div className="mt-8 border-t border-line pt-5 text-center text-[11px] leading-6 text-muted">
          <p>{site.demoNotice}</p>
          <p className="mt-1">
            © {site.name} — نسخه نمایشی برای بررسی طراحی و معماری
          </p>
        </div>
      </div>
    </footer>
  );
}
