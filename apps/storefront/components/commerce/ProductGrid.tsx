import { ProductCard } from "./ProductCard";
import { faNum } from "@/lib/format";
import type { ProductV2 } from "@/lib/catalog";

/**
 * ProductGrid — تنها گرید محصول پروژه (بند ۲۳).
 * موبایل ۲ ستون / تبلت ۳ / دسکتاپ ۴ — بدون masonry.
 */
export function ProductGrid({
  products,
  emptyMessage = "محصولی با این فیلترها پیدا نشد.",
}: {
  products: ProductV2[];
  emptyMessage?: string;
}) {
  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-line bg-surface px-6 py-14 text-center">
        <svg viewBox="0 0 24 24" className="size-10 text-primary" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          <path d="M8.5 11h5" strokeLinecap="round" />
        </svg>
        <p className="max-w-xs text-sm leading-7 text-muted">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4"
      aria-label={`${faNum(products.length)} محصول`}
    >
      {products.map((p) => (
        <ProductCard key={p.id} product={p} />
      ))}
    </div>
  );
}
