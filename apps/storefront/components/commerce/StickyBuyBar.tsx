"use client";

/**
 * Sticky Add to Cart موبایل (بند ۱۴) — در دسکتاپ رندر نمی‌شود.
 * اگر فقط یک واریانت موجود باشد مستقیم اضافه می‌کند؛ وگرنه QuickAdd را باز می‌کند.
 */
import { useEffect, useState } from "react";
import { useCart } from "@/components/providers/CartProvider";
import { cn } from "@/lib/cn";
import { faNum } from "@/lib/format";
import { minPrice, salePriceOf } from "@/lib/catalog-repo";
import type { ProductV2 } from "@/lib/catalog";

export function StickyBuyBar({ product }: { product: ProductV2 }) {
  const { addLine, openQuickAdd } = useCart();
  const [visible, setVisible] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const inStock = product.variants.filter((v) => v.stock > 0);
  const anyStock = inStock.length > 0;
  const base = minPrice(product);
  const sale = salePriceOf(product);

  if (!visible) return null;

  const onAdd = () => {
    if (!anyStock) return;
    if (inStock.length === 1) {
      addLine(inStock[0].id);
      setAdded(true);
      setTimeout(() => setAdded(false), 1800);
    } else {
      openQuickAdd(product.id);
    }
  };

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 lg:hidden",
        "border-t border-line bg-surface/95 px-3 py-2.5 shadow-clay-3 backdrop-blur",
      )}
    >
      <div className="mx-auto flex max-w-7xl items-center gap-3">
        <div className="flex flex-col">
          {sale != null && (
            <del className="text-[11px] text-muted tnum">{faNum(base)}</del>
          )}
          <strong className="text-[15px] font-extrabold text-plum tnum">
            {faNum(sale ?? base)}{" "}
            <span className="text-[10px] font-medium text-muted">تومان</span>
          </strong>
        </div>
        <button
          type="button"
          onClick={onAdd}
          disabled={!anyStock}
          aria-live="polite"
          className={cn(
            "ms-auto inline-flex h-12 flex-1 items-center justify-center rounded-full text-sm font-bold transition-all active:scale-[0.98] sm:flex-none sm:min-w-44",
            !anyStock
              ? "cursor-not-allowed bg-primary-tint text-muted"
              : added
                ? "bg-success text-on-accent"
                : "bg-plum text-on-accent shadow-clay-2",
          )}
        >
          {!anyStock
            ? "ناموجود"
            : added
              ? "به سبدت اضافه شد 💜"
              : inStock.length === 1
                ? "افزودن به سبد"
                : "انتخاب و افزودن"}
        </button>
      </div>
    </div>
  );
}
