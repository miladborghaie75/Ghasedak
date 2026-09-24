"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/providers/CartProvider";
import { SearchBox } from "./SearchBox";
import { ThemeToggle } from "@/components/providers/ThemeToggle";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";
import { site } from "@/lib/site";
import { CATEGORIES as categories } from "@/lib/categories";

/**
 * هدر شناور قرصی — بند ۳۱:
 * موبایل ردیف ۱: راست=منو، وسط=لوگو، چپ=علاقه‌مندی+سبد. ردیف ۲: سرچ تمام‌عرض.
 * دسکتاپ ردیف ۱: لوگو + سرچ + اکشن‌ها. ردیف ۲: ناوبری دسته‌ها.
 * RTL — شمارنده سبد aria-live دارد.
 */
export function Header() {
  const { count, wishlist, ready } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  const actionButtons = (
    <div className="flex items-center gap-1">
      {/* علاقه‌مندی */}
      <Link
        href="/wishlist"
        aria-label={`علاقه‌مندی‌ها${ready && wishlist.length ? `، ${faNum(wishlist.length)} محصول` : ""}`}
        className="relative flex size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-primary-tint hover:text-primary-strong"
      >
        <HeartIcon />
        {ready && wishlist.length > 0 && (
          <span className="absolute -top-0.5 start-0.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-on-accent tnum">
            {faNum(wishlist.length)}
          </span>
        )}
      </Link>

      {/* سبد */}
      <Link
        href="/cart"
        aria-label={`سبد خرید${ready && count ? `، ${faNum(count)} کالا` : "، خالی"}`}
        aria-live="polite"
        className="relative flex size-11 items-center justify-center rounded-full bg-primary-tint text-primary-strong transition-colors hover:bg-primary-soft"
      >
        <CartIcon />
        {ready && count > 0 && (
          <span className="absolute -top-0.5 start-0.5 flex min-w-5 items-center justify-center rounded-full bg-primary-strong px-1 text-[10px] font-bold text-on-accent tnum">
            {faNum(count)}
          </span>
        )}
      </Link>
    </div>
  );

  return (
    <>
      {/* نوار اطلاع Demo — صادقانه و همیشه بالای صفحه */}
      <div className="bg-plum px-4 py-2 text-center text-[11px] font-medium text-on-accent/90">
        {site.demoNotice}
      </div>

      <header className="sticky top-0 z-40 px-3 pb-2 pt-2 sm:px-4">
        <div className="mx-auto max-w-7xl rounded-blob border border-line bg-surface/95 px-3 shadow-clay-1 backdrop-blur sm:px-5">
          {/* ── موبایل: ردیف ۱ — منو راست، لوگو وسط، اکشن‌ها چپ ── */}
          <div className="flex h-14 items-center justify-between md:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="باز کردن منو"
              aria-expanded={menuOpen}
              className="flex size-11 items-center justify-center rounded-full text-ink hover:bg-primary-tint"
            >
              <MenuIcon />
            </button>
            <Link
              href="/"
              aria-label={`${site.fullName} — صفحه اصلی`}
              className="flex items-center gap-1.5 rounded-full py-1"
            >
              <DandelionMark className="size-8" />
              <span className="font-display text-lg text-plum">{site.name}</span>
            </Link>
            {actionButtons}
          </div>

          {/* ── موبایل: ردیف ۲ — سرچ تمام‌عرض ── */}
          <div className="pb-3 md:hidden">
            <SearchBox />
          </div>

          {/* ── دسکتاپ: ردیف ۱ — لوگو، سرچ، اکشن‌ها ── */}
          <div className="hidden h-16 items-center gap-4 md:flex">
            <ThemeToggle />
            <Link
              href="/"
              className="flex shrink-0 items-center gap-2 rounded-full px-1 py-1"
              aria-label={`${site.fullName} — صفحه اصلی`}
            >
              <DandelionMark className="size-9" />
              <span className="flex-col leading-tight">
                <span className="font-display text-xl text-plum">{site.name}</span>
                <span className="text-[10px] text-muted">{site.tagline}</span>
              </span>
            </Link>

            <div className="mx-auto w-full max-w-sm">
              <SearchBox />
            </div>

            {actionButtons}
          </div>

          {/* ── دسکتاپ: ردیف ۲ — ناوبری دسته‌ها ── */}
          <nav aria-label="دسته‌ها" className="hidden items-center gap-1 border-t border-line/60 pb-2 pt-1.5 md:flex">
            {categories.map((c) => (
              <Link
                key={c.id}
                href={`/c/${c.slug}`}
                aria-current={pathname === `/c/${c.slug}` ? "page" : undefined}
                className={cn(
                  "rounded-full px-3 py-2 text-[13px] font-medium transition-colors hover:bg-primary-tint hover:text-primary-strong",
                  pathname === `/c/${c.slug}` ? "bg-primary-tint text-primary-strong" : "text-ink",
                )}
              >
                {c.name}
              </Link>
            ))}
            <Link
              href="/need"
              className={cn(
                "rounded-full px-3 py-2 text-[13px] font-medium transition-colors hover:bg-primary-tint hover:text-primary-strong",
                pathname === "/need" ? "bg-primary-tint text-primary-strong" : "text-primary-strong",
              )}
            >
              چی لازم داری؟
            </Link>
            <Link
              href="/guides/size"
              className="rounded-full px-3 py-2 text-[13px] font-medium text-muted transition-colors hover:bg-primary-tint hover:text-primary-strong"
            >
              راهنمای سایز
            </Link>
          </nav>
        </div>
      </header>

      {/* منوی کشویی موبایل */}
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="منو">
        <MobileMenu onNavigate={() => setMenuOpen(false)} />
      </Sheet>
    </>
  );
}

function MobileMenu({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  return (
    <nav aria-label="منوی اصلی" className="flex flex-col gap-1">
      <p className="mb-1 text-xs font-bold text-muted">دسته‌ها</p>
      {categories.map((c) => (
        <Link
          key={c.id}
          href={`/c/${c.slug}`}
          onClick={onNavigate}
          className="flex h-12 items-center rounded-xl px-3 text-sm font-medium text-ink hover:bg-primary-tint"
        >
          {c.name}
        </Link>
      ))}
      <p className="mb-1 mt-4 text-xs font-bold text-muted">کمک خرید</p>
      {/* کنترل تم — فقط در منوی موبایل (بند ۵۳: بدون شلوغی مسیر خرید، ولی کشف‌پذیر) */}
      <div className="mt-3 rounded-2xl border border-line p-2">
        <ThemeToggle />
      </div>
      <Link href="/guides/size" onClick={onNavigate} className="flex h-12 items-center rounded-xl px-3 text-sm font-medium text-ink hover:bg-primary-tint">
        راهنمای سایز
      </Link>
      <Link href="/wishlist" onClick={onNavigate} className="flex h-12 items-center rounded-xl px-3 text-sm font-medium text-ink hover:bg-primary-tint">
        علاقه‌مندی‌ها
      </Link>
      <Link href="/cart" onClick={onNavigate} className="flex h-12 items-center rounded-xl px-3 text-sm font-medium text-ink hover:bg-primary-tint">
        سبد خرید
      </Link>
    </nav>
  );
}

/* ── آیکون‌های خطی ۱٫۵px ─────────────────────────────── */
function HeartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.2 7.5 3.4 4.5 6.6 4.5c2 0 3.7 1.1 4.4 2.7h2c.7-1.6 2.4-2.7 4.4-2.7 3.2 0 5.4 3 3.9 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function CartIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M6 8h12l-1 12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8z" strokeLinejoin="round" />
      <path d="M9 10V7a3 3 0 0 1 6 0v3" strokeLinecap="round" />
    </svg>
  );
}
function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
    </svg>
  );
}

/** نشان قاصدک — لوگوی clay */
export function DandelionMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <rect width="48" height="48" rx="14" fill="#A67DEA" />
      <g stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none">
        <line x1="24" y1="24" x2="24" y2="12" />
        <line x1="24" y1="24" x2="14" y2="16" />
        <line x1="24" y1="24" x2="34" y2="16" />
        <line x1="24" y1="24" x2="12" y2="26" />
        <line x1="24" y1="24" x2="36" y2="26" />
        <line x1="24" y1="24" x2="17" y2="33" />
        <line x1="24" y1="24" x2="31" y2="33" />
        <path d="M24 30c0 5 .7 8 .3 11" />
      </g>
      <g fill="#fff">
        <circle cx="24" cy="10.5" r="2.2" />
        <circle cx="12.5" cy="14.5" r="2.2" />
        <circle cx="35.5" cy="14.5" r="2.2" />
        <circle cx="10" cy="27" r="2.2" />
        <circle cx="38" cy="27" r="2.2" />
        <circle cx="15.5" cy="35" r="2.2" />
        <circle cx="32.5" cy="35" r="2.2" />
      </g>
    </svg>
  );
}
