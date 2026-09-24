"use client";

import Link from "next/link";
import { useCart } from "@/components/providers/CartProvider";
import { ProductCard } from "@/components/commerce/ProductCard";
import { getAllProductsV2 } from "@/lib/catalog-repo";

export default function WishlistPage() {
  const { wishlist, ready } = useCart();
  const all = getAllProductsV2();
  const items = all.filter((p) => wishlist.includes(p.id));

  if (!ready) {
    return <p className="py-16 text-center text-sm text-muted">در حال بارگذاری…</p>;
  }

  return (
    <div className="mx-auto max-w-7xl px-3 py-6 sm:px-4">
      <h1 className="mb-5 font-display text-3xl text-plum">علاقه‌مندی‌ها</h1>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-card border border-dashed border-line bg-surface px-6 py-16 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary-tint text-primary">
            <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
              <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.2 7.5 3.4 4.5 6.6 4.5c2 0 3.7 1.1 4.4 2.7h2c.7-1.6 2.4-2.7 4.4-2.7 3.2 0 5.4 3 3.9 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <p className="text-sm font-bold text-ink">هنوز چیزی به علاقه‌مندی‌ها اضافه نکرده‌اید</p>
          <p className="max-w-xs text-[13px] leading-7 text-muted">
            روی آیکون قلب هر محصول بزنید تا برای بعد ذخیره شود.
          </p>
          <Link href="/" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-bold text-white shadow-clay-1 hover:bg-primary-hover">
            دیدن محصولات
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {items.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
