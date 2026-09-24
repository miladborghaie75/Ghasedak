"use client";

import { useCart } from "@/components/providers/CartProvider";
import { cn } from "@/lib/cn";

export function WishlistButton({
  productId,
  name,
  className,
}: {
  productId: string;
  name: string;
  className?: string;
}) {
  const { wishlist, toggleWishlist, ready } = useCart();
  const active = ready && wishlist.includes(productId);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `حذف ${name} از علاقه‌مندی‌ها` : `افزودن ${name} به علاقه‌مندی‌ها`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleWishlist(productId);
      }}
      className={cn(
        "flex size-10 items-center justify-center rounded-full bg-surface/95 shadow-clay-1 transition-colors hover:shadow-clay-2",
        active ? "text-primary-strong" : "text-muted hover:text-primary-strong",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden>
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.2 7.5 3.4 4.5 6.6 4.5c2 0 3.7 1.1 4.4 2.7h2c.7-1.6 2.4-2.7 4.4-2.7 3.2 0 5.4 3 3.9 6.8-1.8 4.6-9.3 9.2-9.3 9.2z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
